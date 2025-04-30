import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { EpubReader } from './epubReader';
import { FileManager } from './fileManager';
import { config, updateConfig } from './config';
import { Summarizer } from './summarizer';
import { SpeechSynthesizer } from './speechSynthesizer';

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
      updateConfig({ debug: true });
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
    
    // フラグ設定
    const shouldSummarize = !args.includes('--no-gpt');
    const shouldSynthesize = !args.includes('--no-speech');
    
    // 要約テキスト保存先
    const narratedDir = path.join(config.outputDir, `${epubReader.getFileName()}_narrated`);
    let processedFiles: string[] = [];
    
    // ChatGPTによるテキスト変換
    if (shouldSummarize) {
      console.log(chalk.blue('\nChatGPT APIで会話調テキストに変換中...'));
      
      // サマライザーインスタンスを作成
      const summarizer = new Summarizer();
      
      // すべてのチャプターを処理
      processedFiles = await summarizer.processAllChapters(extractedDir, narratedDir);
      
      console.log(chalk.green(`\n${processedFiles.length}個のチャプターを会話調テキストに変換しました`));
      console.log(`会話調テキストの保存先: ${narratedDir}`);
    } else {
      console.log(chalk.yellow('\nChatGPT APIによる変換はスキップされました'));
    }
    
    // 音声合成処理
    if (shouldSynthesize) {
      if (processedFiles.length > 0 || !shouldSummarize) {
        console.log(chalk.blue('\n音声ファイルを生成中...'));
        
        // 音声合成インスタンスを作成
        const synthesizer = new SpeechSynthesizer(
          config.speech.voice,
          config.speech.rate
        );
        
        // 音声ファイルの保存先ディレクトリ
        const audioDir = path.join(config.outputDir, `${epubReader.getFileName()}_audio`);
        
        // 音声変換する元ディレクトリを決定
        // 要約した場合は要約テキスト、そうでない場合は抽出テキストを使用
        const sourceDir = processedFiles.length > 0 ? narratedDir : extractedDir;
        
        // 音声ファイルを生成
        const audioFiles = await synthesizer.synthesizeDirectory(sourceDir, audioDir, '.aiff');
        
        console.log(chalk.green(`\n${audioFiles.length}個の音声ファイルを生成しました`));
        console.log(`音声ファイルの保存先: ${audioDir}`);
        
        // すべてを結合した一つの音声ファイルも生成
        if (audioFiles.length > 0 && !args.includes('--no-combine')) {
          console.log(chalk.blue('\n全チャプターを結合した音声ファイルを生成中...'));
          
          // テキストファイルのパスリストを取得
          const textFiles = FileManager.getFilesWithExtension(sourceDir, '.txt');
          
          // 結合した音声ファイルのパス
          const combinedAudioPath = path.join(audioDir, `${epubReader.getFileName()}_完全版.aiff`);
          
          // 結合音声ファイルを生成
          await synthesizer.synthesizeCombined(textFiles, combinedAudioPath);
          
          console.log(chalk.green(`\n結合音声ファイルを生成しました: ${combinedAudioPath}`));
          
          // ファイルサイズを表示
          const fileSize = FileManager.formatSize(
            fs.statSync(combinedAudioPath).size
          );
          console.log(`ファイルサイズ: ${fileSize}`);
        }
      } else {
        console.log(chalk.yellow('\n会話調テキストがないため、音声合成はスキップされました'));
      }
    } else {
      console.log(chalk.yellow('\n音声合成はスキップされました'));
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
    
  } catch (error) {
    console.error(chalk.red('\nエラーが発生しました:'), error);
    process.exit(1);
  }
}

// アプリケーション実行
main();
