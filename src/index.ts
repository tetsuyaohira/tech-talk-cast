import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import {EpubReader} from './epubReader';
import {FileManager} from './fileManager';
import {config, updateConfig} from './config';
import {Summarizer} from './summarizer';
import {SpeechSynthesizer} from './speechSynthesizer';
import {generatePodcastRSS} from './rssGenerator';

// 環境変数をロード
dotenv.config();

/**
 * メイン処理
 */
async function main() {
    try {
        console.log(chalk.green('===== TechTalkCast ====='));
        console.log('技術書をポッドキャスト風に変換するアプリ\n');

        // コマンドライン引数からEPUBファイルパスを取得
        const args = process.argv.slice(2);
        if (args.length === 0) {
            console.error(chalk.red('エラー: EPUBファイルのパスを指定してください'));
            console.log('使用法: npm run dev -- /path/to/book.epub');
            process.exit(1);
        }

        const epubFilePath = args[0];

        // EPUBファイルの存在確認
        if (!FileManager.validateEpubFile(epubFilePath)) {
            process.exit(1);
        }

        // デバッグモード設定（オプション）
        if (args.includes('--debug')) {
            updateConfig({debug: true});
            console.log(chalk.yellow('デバッグモードが有効です'));
        }

        // 出力ディレクトリの作成
        FileManager.ensureOutputDirectory();

        // EPUBファイルの解析
        console.log(chalk.blue(`EPUBファイルを解析中: ${epubFilePath}`));
        const epubReader = new EpubReader(epubFilePath);
        await epubReader.open();

        // 書籍のメタデータを表示
        const metadata = epubReader.getMetadata();
        console.log(chalk.cyan('\n書籍情報:'));
        console.log(`タイトル: ${metadata.title}`);
        console.log(`著者: ${metadata.creator || '不明'}`);
        console.log(`言語: ${metadata.language || '不明'}\n`);

        // 目次の取得
        console.log(chalk.blue('目次を取得中...'));
        const toc = await epubReader.getToc();
        console.log(chalk.green(`目次の取得が完了しました (${toc.length}項目)\n`));

        // チャプターの取得と保存
        console.log(chalk.blue('チャプターの抽出中...'));
        const bookDir = FileManager.createBookDirectory(epubReader.getFileName());

        // チャプターの内容をファイルに保存
        await epubReader.saveChaptersToFiles(config.outputDir);

        // リソースディレクトリのパス
        const extractedDir = path.join(config.outputDir, epubReader.getFileName());

        // 抽出されたファイルからh1/h2/h3タグがないファイルをフィルタリング
        console.log(chalk.blue('\n音声化対象ファイルをフィルタリング中...'));
        const allFiles = FileManager.getFilesWithExtension(extractedDir, '.txt');
        const validFiles: string[] = [];
        const skippedFiles: string[] = [];

        for (const file of allFiles) {
            const content = fs.readFileSync(file, 'utf8');
            if (epubReader.hasHeadingTags(content)) {
                validFiles.push(file);
            } else {
                skippedFiles.push(path.basename(file));
            }
        }

        if (skippedFiles.length > 0) {
            console.log(chalk.yellow(`\nh1/h2/h3タグがないためスキップするファイル (${skippedFiles.length}個):`));
            skippedFiles.forEach(file => {
                console.log(chalk.gray(`  - ${file}`));
            });
        }
        console.log(chalk.green(`\n音声化対象ファイル: ${validFiles.length}個`));

        // フラグ設定
        const shouldSummarize = !args.includes('--no-gpt');
        const shouldSynthesize = !args.includes('--no-speech');
        const shouldGenerateRSS = !args.includes('--no-rss');

        // 要約テキスト保存先
        const narratedDir = path.join(config.outputDir, `${epubReader.getFileName()}_narrated`);
        let processedFiles: string[] = [];

        // ChatGPTによるテキスト変換
        if (shouldSummarize) {
            console.log(chalk.blue('\nChatGPT APIで会話調テキストに変換中...'));

            // サマライザーインスタンスを作成
            const summarizer = new Summarizer();

            // フィルタリングされたチャプターのみを処理
            processedFiles = await summarizer.processValidChapters(validFiles, narratedDir);

            console.log(chalk.green(`\n${processedFiles.length}個のチャプターを会話調テキストに変換しました`));
            console.log(`会話調テキストの保存先: ${narratedDir}`);
        } else {
            console.log(chalk.yellow('\nChatGPT APIによる変換はスキップされました'));
        }

        // 音声合成処理
        if (shouldSynthesize) {
            console.log(chalk.blue('\n音声ファイルを生成中...'));

            // 音声合成インスタンスを作成
            const synthesizer = new SpeechSynthesizer(
                config.speech.voice,
                config.speech.rate
            );

            // 音声ファイルの保存先ディレクトリ
            const audioDir = path.join(config.outputDir, `${epubReader.getFileName()}_audio`);

            // 音声変換する元ファイルリストを決定
            let sourceFiles: string[] = [];
            
            // --no-gptが指定された場合、_narratedディレクトリが存在すればそれを使用
            if (!shouldSummarize && fs.existsSync(narratedDir)) {
                const narratedFiles = FileManager.getFilesWithExtension(narratedDir, '.txt');
                if (narratedFiles.length > 0) {
                    sourceFiles = narratedFiles;
                    console.log(chalk.yellow('既存の会話調テキストから音声を生成します'));
                } else {
                    sourceFiles = validFiles;
                    console.log(chalk.yellow('会話調テキストが見つからないため、元のテキストから音声を生成します'));
                }
            } else if (processedFiles.length > 0) {
                sourceFiles = processedFiles;
            } else {
                sourceFiles = validFiles;
            }

            // 音声ファイルを生成
            const audioFiles = await synthesizer.synthesizeFiles(sourceFiles, audioDir, '.aiff');

            console.log(chalk.green(`\n${audioFiles.length}個の音声ファイルを生成しました`));
            console.log(`音声ファイルの保存先: ${audioDir}`);

            // すべてを結合した一つの音声ファイルも生成
            if (audioFiles.length > 0 && !args.includes('--no-combine')) {
                console.log(chalk.blue('\n全チャプターを結合した音声ファイルを生成中...'));

                // 結合した音声ファイルのパス
                const combinedAudioPath = path.join(audioDir, `${epubReader.getFileName()}_完全版.aiff`);

                // 結合音声ファイルを生成
                await synthesizer.synthesizeCombined(sourceFiles, combinedAudioPath);

                console.log(chalk.green(`\n結合音声ファイルを生成しました: ${combinedAudioPath}`));

                // ファイルサイズを表示
                const fileSize = FileManager.formatSize(
                    fs.statSync(combinedAudioPath).size
                );
                console.log(`ファイルサイズ: ${fileSize}`);
            }
        } else {
            console.log(chalk.yellow('\n音声合成はスキップされました'));
        }

        // RSSフィード生成処理
        if (shouldGenerateRSS) {
            const audioDir = path.join(config.outputDir, `${epubReader.getFileName()}_audio`);
            
            // 音声ファイルが存在するかチェック
            if (fs.existsSync(audioDir)) {
                const mp3Files = fs.readdirSync(audioDir).filter(file => file.endsWith('.mp3'));
                
                if (mp3Files.length > 0) {
                    console.log(chalk.blue('\nRSSフィードを生成中...'));
                    
                    try {
                        const rssPath = await generatePodcastRSS(
                            epubReader.getFileName(),
                            config.outputDir,
                            config.podcast.baseUrl,
                            {
                                author: metadata.creator || config.podcast.author,
                                description: `技術書「${metadata.title}」をポッドキャスト形式で配信`,
                                category: config.podcast.category,
                                imageUrl: config.podcast.imageUrl
                            }
                        );

                        console.log(chalk.green('\nRSSフィードの生成が完了しました！'));
                        console.log(chalk.magenta('\n📱 ポッドキャスト配信の手順:'));
                        console.log('1. 音声ファイル(.mp3)をS3にアップロード');
                        console.log('2. 生成されたRSSファイルをS3にアップロード');
                        console.log('3. RSSのURLをポッドキャストアプリに登録');
                        console.log(chalk.blue(`\nRSSファイル: ${path.basename(rssPath)}`));
                        
                    } catch (error) {
                        console.log(chalk.yellow(`RSS生成をスキップしました: ${error}`));
                    }
                } else {
                    console.log(chalk.yellow('\nMP3ファイルが見つからないため、RSS生成をスキップしました'));
                    console.log(chalk.blue('まずはmp3ファイルに変換してください:'));
                    console.log(`cd ${audioDir}`);
                    console.log('for f in *.aiff; do ffmpeg -i "$f" -codec:a libmp3lame -b:a 192k "${f%.aiff}.mp3"; done');
                }
            } else {
                console.log(chalk.yellow('\n音声ファイルディレクトリが見つからないため、RSS生成をスキップしました'));
            }
        } else {
            console.log(chalk.yellow('\nRSS生成はスキップされました'));
        }

        console.log(chalk.green('\n処理が完了しました'));
        console.log(`抽出済みテキストの保存先: ${bookDir}`);

        // 使用方法の説明
        console.log(chalk.cyan('\n=== 使用方法 ==='));
        console.log('- 抽出テキスト: output/' + epubReader.getFileName());
        if (processedFiles.length > 0) {
            console.log('- 会話調テキスト: output/' + epubReader.getFileName() + '_narrated');
        }
        if (shouldSynthesize) {
            console.log('- 音声ファイル: output/' + epubReader.getFileName() + '_audio');
        }
        if (shouldGenerateRSS) {
            const rssFileName = `${epubReader.getFileName().replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '-').toLowerCase()}-podcast.xml`;
            console.log('- RSSフィード: output/' + rssFileName);
        }

    } catch (error) {
        console.error(chalk.red('\nエラーが発生しました:'), error);
        process.exit(1);
    }
}

// アプリケーション実行
main();
