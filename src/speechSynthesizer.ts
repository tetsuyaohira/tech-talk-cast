import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { config } from './config';
import { textFormatter } from './textFormatter';

// execをPromiseでラップ
const execPromise = util.promisify(exec);

/**
 * チャプター情報の型定義
 */
export interface ChapterInfo {
    title: string;
    fileName: string;
    startTime: number;  // 秒単位
    duration: number;   // 秒単位
}

/**
 * 音声合成を扱うクラス
 * macOSのsayコマンドを使用して文字列から音声ファイルを生成
 */
export class SpeechSynthesizer {
    private voice: string;
    private rate: number;

    constructor(voice?: string, rate?: number) {
        this.voice = voice || config.speech.voice;
        this.rate = rate || config.speech.rate;
    }

    /**
     * テキストに適切な間（ポーズ）を挿入する
     * @param text 変換前のテキスト
     * @returns ポーズを挿入したテキスト
     */
    private addPauses(text: string): string {
        return text
            // 日本語の句読点に対応
            .replace(/。/g, '。[[slnc 400]]')    // 句点に400ミリ秒の間を入れる
            .replace(/、/g, '、[[slnc 200]]')    // 読点に200ミリ秒の間を入れる
            .replace(/！/g, '！[[slnc 450]]')    // 感嘆符に450ミリ秒の間を入れる
            .replace(/？/g, '？[[slnc 450]]')    // 疑問符に450ミリ秒の間を入れる
            
            // 英語の句読点に対応
            .replace(/\.\s+/g, '.[[slnc 400]] ') // ピリオドの後に400ミリ秒の間を入れる
            .replace(/,\s+/g, ',[[slnc 200]] ')  // コンマの後に200ミリ秒の間を入れる
            .replace(/!\s+/g, '![[slnc 450]] ')  // 感嘆符の後に450ミリ秒の間を入れる
            .replace(/\?\s+/g, '?[[slnc 450]] ') // 疑問符の後に450ミリ秒の間を入れる
            .replace(/:\s+/g, ':[[slnc 300]] ')  // コロンの後に300ミリ秒の間を入れる
            .replace(/;\s+/g, ';[[slnc 250]] ')  // セミコロンの後に250ミリ秒の間を入れる
            
            // 段落や話題の変わり目
            .replace(/\n\n/g, '[[slnc 700]]\n\n')  // 段落間に700ミリ秒の間を入れる
            .replace(/\n(?=\S)/g, '\n[[slnc 500]]') // 改行の後、次が空白でない場合に500ミリ秒の間を入れる

            // 話題の切り替わりを示す表現の前後
            .replace(/(ねえ|あのね|さて|それから|ところで|話は変わるけど|他にも|最後に)/g, '[[slnc 500]]$1[[slnc 200]]');
    }

    /**
     * テキストから音声ファイルを生成
     * @param text 読み上げるテキスト
     * @param outputPath 出力ファイルのパス (.mp3)
     */
    async synthesize(text: string, outputPath: string): Promise<void> {
        const tempTextFile = `${outputPath}.temp.txt`;
        const tempAiffFile = outputPath.replace(/\.(mp3|m4a)$/, '.temp.aiff');
        const outputFile = outputPath;
        
        try {
            // ディレクトリが存在しない場合は作成
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, {recursive: true});
            }

            // 既存の一時ファイルがあれば削除
            if (fs.existsSync(tempTextFile)) {
                fs.unlinkSync(tempTextFile);
            }
            if (fs.existsSync(tempAiffFile)) {
                fs.unlinkSync(tempAiffFile);
            }

            // 音声に適した形式にテキストを整形
            let formattedText = textFormatter.prepareForSpeech(text);
            
            // テキストに適切な間（ポーズ）を挿入
            formattedText = this.addPauses(formattedText);

            // 一時的にテキストファイルを保存（長いテキストのため）
            fs.writeFileSync(tempTextFile, formattedText, 'utf8');

            // sayコマンドを実行して音声ファイルを生成（-yオプションで上書き確認をスキップ）
            const command = `say -r ${this.rate} -f "${tempTextFile}" -o "${tempAiffFile}" && ffmpeg -y -i "${tempAiffFile}" -codec:a libmp3lame -b:a 192k "${outputFile}" && rm "${tempAiffFile}"`;

            console.log(`音声合成を実行中... (${path.basename(outputFile)})`);
            await execPromise(command, { timeout: 300000 }); // 5分のタイムアウト

            // 一時ファイルを削除
            if (fs.existsSync(tempTextFile)) {
                fs.unlinkSync(tempTextFile);
            }

            console.log(`音声ファイルを生成しました: ${outputFile}`);
        } catch (error) {
            // エラー時でも一時ファイルを削除
            if (fs.existsSync(tempTextFile)) {
                fs.unlinkSync(tempTextFile);
            }
            if (fs.existsSync(tempAiffFile)) {
                fs.unlinkSync(tempAiffFile);
            }
            
            console.error('音声合成中にエラーが発生しました:', error);
            throw new Error(`音声合成に失敗しました: ${error}`);
        }
    }

    /**
     * 音声ファイルの長さを取得（秒単位）
     */
    async getAudioDuration(filePath: string): Promise<number> {
        try {
            const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
            const { stdout } = await execPromise(command);
            return parseFloat(stdout.trim());
        } catch (error) {
            console.error(`音声ファイルの長さ取得に失敗しました: ${filePath}`, error);
            return 0;
        }
    }

    /**
     * 指定されたファイルリストを音声合成
     * @param inputFiles 入力ファイルパスの配列
     * @param outputDir 出力音声ファイルのディレクトリ
     * @param fileExtension 出力ファイルの拡張子 (デフォルト: .aiff)
     * @returns 生成された音声ファイルのパスとチャプター情報
     */
    async synthesizeFiles(
        inputFiles: string[],
        outputDir: string,
        fileExtension: string = '.aiff'
    ): Promise<{ audioFiles: string[], chapters: ChapterInfo[] }> {
        // 出力ディレクトリが存在しない場合は作成
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
        }

        const outputFiles: string[] = [];
        const chapters: ChapterInfo[] = [];
        let currentStartTime = 0;

        console.log(`${inputFiles.length}個のファイルを音声に変換します...`);

        // 各ファイルを処理
        for (let i = 0; i < inputFiles.length; i++) {
            const inputFile = inputFiles[i];
            const fileName = path.basename(inputFile, '.txt');
            const outputFile = path.join(outputDir, fileName + fileExtension);

            try {
                // テキストを読み込む
                const text = fs.readFileSync(inputFile, 'utf8');

                console.log(`[${i + 1}/${inputFiles.length}] 音声合成中: ${path.basename(inputFile)}`);

                // 音声合成を実行
                await this.synthesize(text, outputFile);
                outputFiles.push(outputFile);

                // 音声ファイルの長さを取得
                const duration = await this.getAudioDuration(outputFile);

                // チャプターのタイトルを抽出（ファイル名から番号部分とnarrated_を除去）
                const cleanFileName = fileName.replace(/^narrated_/, '');
                const titleMatch = cleanFileName.match(/^\d+-(.+)$/);
                const title = titleMatch ? titleMatch[1] : cleanFileName;

                // チャプター情報を記録
                chapters.push({
                    title: title,
                    fileName: fileName,
                    startTime: currentStartTime,
                    duration: duration
                });

                // 次のチャプターの開始時間を計算
                // 最後のチャプター以外は1秒のポーズを追加
                if (i < inputFiles.length - 1) {
                    currentStartTime += duration + 1.0;  // チャプター間の1秒ポーズを考慮
                } else {
                    currentStartTime += duration;  // 最後のチャプターの後はポーズなし
                }

            } catch (error) {
                console.error(`ファイル "${inputFile}" の音声合成に失敗しました:`, error);
            }
        }

        return { audioFiles: outputFiles, chapters };
    }

    /**
     * ディレクトリ内のすべてのテキストファイルを音声ファイルに変換
     * @param inputDir 入力テキストファイルのディレクトリ
     * @param outputDir 出力音声ファイルのディレクトリ
     * @param fileExtension 出力ファイルの拡張子 (デフォルト: .aiff)
     */
    async synthesizeDirectory(
        inputDir: string,
        outputDir: string,
        fileExtension: string = '.aiff'
    ): Promise<string[]> {
        if (!fs.existsSync(inputDir)) {
            throw new Error(`入力ディレクトリが存在しません: ${inputDir}`);
        }

        // 出力ディレクトリが存在しない場合は作成
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
        }

        // ディレクトリ内のテキストファイルを取得
        const files = fs.readdirSync(inputDir)
            .filter(file => file.endsWith('.txt'))
            .sort(); // 名前順にソート

        const outputFiles: string[] = [];

        console.log(`${files.length}個のファイルを音声に変換します...`);

        // 各ファイルを処理
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const inputFile = path.join(inputDir, file);
            const outputFilename = path.basename(file, '.txt') + fileExtension;
            const outputFile = path.join(outputDir, outputFilename);

            try {
                // テキストを読み込む
                const text = fs.readFileSync(inputFile, 'utf8');

                console.log(`[${i + 1}/${files.length}] 音声合成中: ${file}`);

                // 音声合成を実行
                await this.synthesize(text, outputFile);
                outputFiles.push(outputFile);

            } catch (error) {
                console.error(`ファイル "${file}" の音声合成に失敗しました:`, error);
            }
        }

        return outputFiles;
    }

    /**
     * 利用可能な音声リストを取得
     */
    async getAvailableVoices(): Promise<string[]> {
        try {
            const {stdout} = await execPromise('say -v ?');

            // 出力から音声名を抽出
            const voices = stdout
                .split('\n')
                .filter(line => line.trim().length > 0)
                .map(line => {
                    // 最初の単語が音声名
                    const match = line.match(/^(\S+)/);
                    return match ? match[1] : null;
                })
                .filter(voice => voice !== null) as string[];

            return voices;
        } catch (error) {
            console.error('利用可能な音声の取得に失敗しました:', error);
            return [];
        }
    }

    /**
     * 複数のテキストファイルを結合して一つの音声ファイルにする
     * @param inputFiles 入力テキストファイルのパスの配列
     * @param outputFile 出力音声ファイルのパス
     * @param chapters チャプター情報の配列（オプション）
     */
    async synthesizeCombined(inputFiles: string[], outputFile: string, chapters?: ChapterInfo[]): Promise<void> {
        try {
            // 一時的に結合したテキストファイルを作成
            const tempTextFile = path.join(path.dirname(outputFile), 'combined_temp.txt');
            let combinedText = '';

            // 各ファイルのテキストを読み込んで結合
            for (const file of inputFiles) {
                if (fs.existsSync(file)) {
                    const text = fs.readFileSync(file, 'utf8');
                    combinedText += text + '\n\n[[slnc 1000]]\n\n'; // チャプター間に長めの間を挿入
                }
            }

            // 結合したテキストを整形
            let formattedText = textFormatter.prepareForSpeech(combinedText);
            
            // テキストに適切な間（ポーズ）を挿入
            formattedText = this.addPauses(formattedText);

            fs.writeFileSync(tempTextFile, formattedText, 'utf8');

            // 出力形式を判定（MP3またはM4A）
            const isM4A = outputFile.endsWith('.m4a');

            if (isM4A && chapters && chapters.length > 0) {
                // M4A形式でチャプター情報を含める場合
                const tempAiffFile = path.join(path.dirname(outputFile), 'combined_temp.aiff');
                
                // チャプターメタデータファイルを作成
                const metadataFile = path.join(path.dirname(outputFile), 'combined_metadata.txt');
                let metadataContent = ';FFMETADATA1\n';
                
                chapters.forEach((chapter) => {
                    const startMs = Math.floor(chapter.startTime * 1000);
                    const endMs = Math.floor((chapter.startTime + chapter.duration) * 1000);
                    metadataContent += `[CHAPTER]\n`;
                    metadataContent += `TIMEBASE=1/1000\n`;
                    metadataContent += `START=${startMs}\n`;
                    metadataContent += `END=${endMs}\n`;
                    metadataContent += `title=${chapter.title}\n\n`;
                });
                
                fs.writeFileSync(metadataFile, metadataContent, 'utf8');
                
                // Log chapter metadata for debugging
                console.log(`チャプターメタデータファイルを作成しました: ${metadataFile}`);
                console.log(`チャプター数: ${chapters.length}`);
                
                // M4A with chapters
                console.log(`結合した音声ファイルを生成中... (${path.basename(outputFile)})`);
                console.log(`チャプター数: ${chapters.length}`);
                
                // Step 1: Generate AIFF using say command
                console.log('Step 1: 音声合成を実行中...');
                const sayCommand = `say -r ${this.rate} -f "${tempTextFile}" -o "${tempAiffFile}"`;
                console.log(`実行コマンド: ${sayCommand}`);
                console.log(`入力ファイル: ${tempTextFile} (${(fs.statSync(tempTextFile).size / 1024).toFixed(2)} KB)`);
                await execPromise(sayCommand);
                
                // Step 2: Convert to M4A with chapters using ffmpeg
                console.log('Step 2: M4A変換とチャプター埋め込みを実行中...');
                const ffmpegCommand = `ffmpeg -y -i "${tempAiffFile}" -i "${metadataFile}" -map 0 -map_metadata 1 -codec:a aac -b:a 192k -movflags +faststart "${outputFile}"`;
                console.log(`実行コマンド: ${ffmpegCommand}`);
                if (fs.existsSync(tempAiffFile)) {
                    console.log(`AIFFファイル: ${tempAiffFile} (${(fs.statSync(tempAiffFile).size / 1024 / 1024).toFixed(2)} MB)`);
                }
                if (fs.existsSync(metadataFile)) {
                    console.log(`メタデータファイル: ${metadataFile} (${fs.statSync(metadataFile).size} bytes)`);
                }
                await execPromise(ffmpegCommand);
                
                // Step 3: Clean up temporary files
                console.log('Step 3: 一時ファイルを削除中...');
                if (fs.existsSync(tempAiffFile)) {
                    fs.unlinkSync(tempAiffFile);
                }
                if (fs.existsSync(metadataFile)) {
                    fs.unlinkSync(metadataFile);
                }
            } else {
                // MP3形式（チャプターなし）
                console.log(`結合した音声ファイルを生成中... (${path.basename(outputFile)})`);
                
                // Step 1: Generate AIFF using say command
                console.log('Step 1: 音声合成を実行中...');
                const tempAiffFile = path.join(path.dirname(outputFile), 'combined_temp.aiff');
                const sayCommand = `say -r ${this.rate} -f "${tempTextFile}" -o "${tempAiffFile}"`;
                console.log(`実行コマンド: ${sayCommand}`);
                console.log(`入力ファイル: ${tempTextFile} (${(fs.statSync(tempTextFile).size / 1024).toFixed(2)} KB)`);
                await execPromise(sayCommand);
                
                // Step 2: Convert to MP3 using ffmpeg
                console.log('Step 2: MP3変換を実行中...');
                const ffmpegCommand = `ffmpeg -y -i "${tempAiffFile}" -codec:a libmp3lame -b:a 192k "${outputFile}"`;
                console.log(`実行コマンド: ${ffmpegCommand}`);
                if (fs.existsSync(tempAiffFile)) {
                    console.log(`AIFFファイル: ${tempAiffFile} (${(fs.statSync(tempAiffFile).size / 1024 / 1024).toFixed(2)} MB)`);
                }
                await execPromise(ffmpegCommand);
                
                // Step 3: Clean up temporary files
                console.log('Step 3: 一時ファイルを削除中...');
                if (fs.existsSync(tempAiffFile)) {
                    fs.unlinkSync(tempAiffFile);
                }
            }

            // 一時ファイルを削除
            if (fs.existsSync(tempTextFile)) {
                fs.unlinkSync(tempTextFile);
            }

            console.log(`結合した音声ファイルを生成しました: ${outputFile}`);
            
            // Verify chapters were embedded
            if (isM4A && chapters && chapters.length > 0) {
                try {
                    const { stdout } = await execPromise(`ffprobe -show_chapters -print_format json "${outputFile}" 2>/dev/null | grep -c '"id":'`);
                    const chapterCount = parseInt(stdout.trim());
                    if (chapterCount > 0) {
                        console.log(`✅ ${chapterCount}個のチャプターが正常に埋め込まれました`);
                    } else {
                        console.log(`⚠️  チャプターの埋め込みに失敗した可能性があります`);
                    }
                } catch (error) {
                    // Ignore verification errors
                }
            }
        } catch (error) {
            console.error('結合音声の生成中にエラーが発生しました:', error);
            throw new Error(`結合音声の生成に失敗しました: ${error}`);
        }
    }
}
