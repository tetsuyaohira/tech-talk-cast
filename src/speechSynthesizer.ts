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
   * テキストから音声ファイルを生成
   * @param text 読み上げるテキスト
   * @param outputPath 出力ファイルのパス (.aiff)
   */
  async synthesize(text: string, outputPath: string): Promise<void> {
    try {
      // ディレクトリが存在しない場合は作成
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 音声に適した形式にテキストを整形
      const formattedText = textFormatter.prepareForSpeech(text);
      
      // 一時的にテキストファイルを保存（長いテキストのため）
      const tempTextFile = `${outputPath}.temp.txt`;
      fs.writeFileSync(tempTextFile, formattedText, 'utf8');
      
      // sayコマンドを実行して音声ファイルを生成
      // const command = `say -r ${this.rate} -f "${tempTextFile}" -o "${outputPath}"`;
      const command = `say -v "${this.voice}" -r ${this.rate} -f "${tempTextFile}" -o "${outputPath}"`;

      console.log(`音声合成を実行中... (${path.basename(outputPath)})`);
      await execPromise(command);
      
      // 一時ファイルを削除
      if (fs.existsSync(tempTextFile)) {
        fs.unlinkSync(tempTextFile);
      }
      
      console.log(`音声ファイルを生成しました: ${outputPath}`);
    } catch (error) {
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
      fs.mkdirSync(outputDir, { recursive: true });
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
        
        console.log(`[${i+1}/${files.length}] 音声合成中: ${file}`);
        
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
      const { stdout } = await execPromise('say -v ?');
      
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
          combinedText += text + '\n\n';
        }
      }
      
      // 結合したテキストを整形
      const formattedText = textFormatter.prepareForSpeech(combinedText);
      fs.writeFileSync(tempTextFile, formattedText, 'utf8');
      
      // sayコマンドで音声ファイルを生成
      const command = `say -v "${this.voice}" -r ${this.rate} -f "${tempTextFile}" -o "${outputFile}"`;
      
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
