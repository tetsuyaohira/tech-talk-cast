import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import {EpubReader} from './epubReader';
import {FileManager} from './fileManager';
import {config, updateConfig} from './config';
import {Summarizer} from './summarizer';
import {SpeechSynthesizer, ChapterInfo} from './speechSynthesizer';
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
        const combineOnly = args.includes('--combine-only');

        // 要約テキスト保存先
        const narratedDir = path.join(config.outputDir, `${FileManager.sanitizeFileName(epubReader.getFileName())}_narrated`);
        let processedFiles: string[] = [];

        // --combine-onlyの場合、既存の音声ファイルから結合のみ実行
        if (combineOnly) {
            console.log(chalk.blue('\n--combine-only モード: 既存の音声ファイルを結合します'));
            
            const audioDir = path.join(config.outputDir, `${FileManager.sanitizeFileName(epubReader.getFileName())}_audio`);
            
            // 音声ファイルディレクトリの存在確認
            if (!fs.existsSync(audioDir)) {
                console.error(chalk.red('エラー: 音声ファイルディレクトリが見つかりません'));
                console.log(`期待されるパス: ${audioDir}`);
                process.exit(1);
            }
            
            // 既存のMP3ファイルを取得
            const audioFiles = FileManager.getFilesWithExtension(audioDir, '.mp3');
            
            if (audioFiles.length === 0) {
                console.error(chalk.red('エラー: MP3ファイルが見つかりません'));
                process.exit(1);
            }
            
            console.log(chalk.green(`${audioFiles.length}個の音声ファイルが見つかりました`));
            
            // 音声合成インスタンスを作成
            const synthesizer = new SpeechSynthesizer(
                config.speech.voice,
                config.speech.rate
            );
            
            // チャプター情報を再構築（音声ファイルから長さを取得）
            const chapters: ChapterInfo[] = [];
            let currentStartTime = 0;
            
            console.log(chalk.blue('\nチャプター情報を再構築中...'));
            
            for (let i = 0; i < audioFiles.length; i++) {
                const audioFile = audioFiles[i];
                const fileName = path.basename(audioFile, '.mp3');
                
                // 音声ファイルの長さを取得
                const duration = await synthesizer.getAudioDuration(audioFile);
                
                // チャプターのタイトルを抽出（narrated_と番号部分を除去）
                const cleanFileName = fileName.replace(/^narrated_/, '');
                const titleMatch = cleanFileName.match(/^\d+-(.+)$/);
                const title = titleMatch ? titleMatch[1] : cleanFileName;
                
                chapters.push({
                    title: title,
                    fileName: fileName,
                    startTime: currentStartTime,
                    duration: duration
                });
                
                // 次のチャプターの開始時間を計算
                if (i < audioFiles.length - 1) {
                    currentStartTime += duration + 1.0;
                } else {
                    currentStartTime += duration;
                }
            }
            
            // テキストファイルのパスを取得（narratedまたは元のテキスト）
            let textFiles: string[] = [];
            if (fs.existsSync(narratedDir)) {
                textFiles = FileManager.getFilesWithExtension(narratedDir, '.txt');
            }
            if (textFiles.length === 0) {
                textFiles = validFiles;
            }
            
            // 結合音声ファイルを生成
            console.log(chalk.blue('\n全チャプターを結合した音声ファイルを生成中...'));
            
            const combinedAudioPath = path.join(audioDir, `${epubReader.getFileName()}_完全版.m4a`);
            await synthesizer.synthesizeCombined(textFiles, combinedAudioPath, chapters);
            
            console.log(chalk.green(`\n結合音声ファイルを生成しました: ${combinedAudioPath}`));
            console.log(chalk.yellow('チャプター情報付きM4A形式で出力されました'));
            
            // ファイルサイズを表示
            const fileSize = FileManager.formatSize(
                fs.statSync(combinedAudioPath).size
            );
            console.log(`ファイルサイズ: ${fileSize}`);
            
            // チャプター情報を表示
            if (chapters.length > 0) {
                console.log(chalk.cyan('\n=== チャプター情報 ==='));
                chapters.forEach((chapter, index) => {
                    const startTime = new Date(chapter.startTime * 1000).toISOString().substr(11, 8);
                    console.log(`${index + 1}. ${chapter.title} (${startTime}～)`);
                });
            }
            
            // RSS生成（--no-rssでない場合）
            if (!args.includes('--no-rss')) {
                console.log(chalk.blue('\n個別RSSフィードを生成中...'));
                
                try {
                    // 完全版の総時間を計算
                    const totalDuration = chapters.reduce((sum, ch) => sum + ch.duration, 0) + (chapters.length - 1);
                    const hours = Math.floor(totalDuration / 3600);
                    const minutes = Math.floor((totalDuration % 3600) / 60);
                    const seconds = Math.floor(totalDuration % 60);
                    const durationStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    
                    const metadata = epubReader.getMetadata();
                    const rssPath = await generatePodcastRSS(
                        epubReader.getFileName(),
                        combinedAudioPath,
                        config.podcast.baseUrl,
                        {
                            author: metadata.creator || config.podcast.author,
                            description: `技術書「${metadata.title}」をポッドキャスト形式で配信`,
                            category: config.podcast.category,
                            imageUrl: config.podcast.imageUrl,
                            duration: durationStr
                        }
                    );

                    console.log(chalk.green('\n個別RSSフィードの生成が完了しました！'));
                    console.log(chalk.magenta('\n📱 ポッドキャスト配信の手順:'));
                    console.log('1. 完全版音声ファイル(.m4a)をS3にアップロード');
                    console.log('2. 個別RSSの<item>要素を配信用podcast.xmlにコピー');
                    console.log('3. 統合されたpodcast.xmlをS3にアップロード');
                    console.log('4. RSSのURLをポッドキャストアプリに登録');
                    
                } catch (error) {
                    console.log(chalk.yellow(`RSS生成をスキップしました: ${error}`));
                }
            }
            
            console.log(chalk.green('\n処理が完了しました'));
            return;
        }

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
            const audioDir = path.join(config.outputDir, `${FileManager.sanitizeFileName(epubReader.getFileName())}_audio`);

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
            const result = await synthesizer.synthesizeFiles(sourceFiles, audioDir, '.mp3');
            const audioFiles = result.audioFiles;
            const chapters = result.chapters;

            console.log(chalk.green(`\n${audioFiles.length}個の音声ファイルを生成しました`));
            console.log(`音声ファイルの保存先: ${audioDir}`);

            // すべてを結合した一つの音声ファイルも生成
            if (audioFiles.length > 0 && !args.includes('--no-combine')) {
                console.log(chalk.blue('\n全チャプターを結合した音声ファイルを生成中...'));

                // 結合した音声ファイルのパス（M4A形式でチャプター対応）
                const combinedAudioPath = path.join(audioDir, `${epubReader.getFileName()}_完全版.m4a`);

                // 結合音声ファイルを生成（チャプター情報付き）
                await synthesizer.synthesizeCombined(sourceFiles, combinedAudioPath, chapters);

                console.log(chalk.green(`\n結合音声ファイルを生成しました: ${combinedAudioPath}`));
                console.log(chalk.yellow('チャプター情報付きM4A形式で出力されました'));

                // ファイルサイズを表示
                const fileSize = FileManager.formatSize(
                    fs.statSync(combinedAudioPath).size
                );
                console.log(`ファイルサイズ: ${fileSize}`);
                
                // チャプター情報を表示
                if (chapters.length > 0) {
                    console.log(chalk.cyan('\n=== チャプター情報 ==='));
                    chapters.forEach((chapter, index) => {
                        const startTime = new Date(chapter.startTime * 1000).toISOString().substr(11, 8);
                        console.log(`${index + 1}. ${chapter.title} (${startTime}～)`);
                    });
                }
                
                // RSS生成（完全版生成後）
                if (shouldGenerateRSS) {
                    console.log(chalk.blue('\n個別RSSフィードを生成中...'));
                    
                    try {
                        // 完全版の総時間を計算
                        const totalDuration = chapters.reduce((sum, ch) => sum + ch.duration, 0) + (chapters.length - 1);
                        const hours = Math.floor(totalDuration / 3600);
                        const minutes = Math.floor((totalDuration % 3600) / 60);
                        const seconds = Math.floor(totalDuration % 60);
                        const durationStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                        
                        const rssPath = await generatePodcastRSS(
                            epubReader.getFileName(),
                            combinedAudioPath,
                            config.podcast.baseUrl,
                            {
                                author: metadata.creator || config.podcast.author,
                                description: `技術書「${metadata.title}」をポッドキャスト形式で配信`,
                                category: config.podcast.category,
                                imageUrl: config.podcast.imageUrl,
                                duration: durationStr
                            }
                        );

                        console.log(chalk.green('\n個別RSSフィードの生成が完了しました！'));
                        console.log(chalk.magenta('\n📱 ポッドキャスト配信の手順:'));
                        console.log('1. 完全版音声ファイル(.m4a)をS3にアップロード');
                        console.log('2. 個別RSSの<item>要素を配信用podcast.xmlにコピー');
                        console.log('3. 統合されたpodcast.xmlをS3にアップロード');
                        console.log('4. RSSのURLをポッドキャストアプリに登録');
                        
                    } catch (error) {
                        console.log(chalk.yellow(`RSS生成をスキップしました: ${error}`));
                    }
                }
            }
        } else {
            console.log(chalk.yellow('\n音声合成はスキップされました'));
        }


        console.log(chalk.green('\n処理が完了しました'));
        console.log(`抽出済みテキストの保存先: ${bookDir}`);

        // 使用方法の説明
        console.log(chalk.cyan('\n=== 使用方法 ==='));
        console.log('- 抽出テキスト: output/' + FileManager.sanitizeFileName(epubReader.getFileName()));
        if (processedFiles.length > 0) {
            console.log('- 会話調テキスト: output/' + FileManager.sanitizeFileName(epubReader.getFileName()) + '_narrated');
        }
        if (shouldSynthesize) {
            console.log('- 音声ファイル: output/' + FileManager.sanitizeFileName(epubReader.getFileName()) + '_audio');
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
