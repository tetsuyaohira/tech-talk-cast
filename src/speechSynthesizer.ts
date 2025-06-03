import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { config } from './config';
import { textFormatter } from './textFormatter';

// execをPromiseでラップ
const execPromise = util.promisify(exec);

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
        const tempAiffFile = outputPath;
        const outputFile = outputPath.replace(/\.aiff$/, '.mp3');
        
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
     */
    async synthesizeCombined(inputFiles: string[], outputFile: string): Promise<void> {
        try {
            // 一時的に結合したテキストファイルを作成
            const tempTextFile = `${outputFile}.temp.txt`;
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

            // sayコマンドで音声ファイルを生成（-yオプションで上書き確認をスキップ）
            const command = `say -r ${this.rate} -f "${tempTextFile}" -o temp.aiff && ffmpeg -y -i temp.aiff -codec:a libmp3lame -b:a 192k "${outputFile}" && rm temp.aiff`;
            // const command = `say -v "${this.voice}" -r ${this.rate} -f "${tempTextFile}" -o "${outputFile}"`;

            console.log(`結合した音声ファイルを生成中... (${path.basename(outputFile)})`);
            await execPromise(command);

            // 一時ファイルを削除
            if (fs.existsSync(tempTextFile)) {
                fs.unlinkSync(tempTextFile);
            }

            console.log(`結合した音声ファイルを生成しました: ${outputFile}`);
        } catch (error) {
            console.error('結合音声の生成中にエラーが発生しました:', error);
            throw new Error(`結合音声の生成に失敗しました: ${error}`);
        }
    }
}
