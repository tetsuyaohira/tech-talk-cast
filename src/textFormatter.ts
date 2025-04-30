import * as cheerio from 'cheerio';

/**
 * テキストフォーマッター
 * EPUBから抽出したHTMLテキストを整形して要約しやすくする
 */
class TextFormatter {
  /**
   * 要約のためにテキストを前処理
   */
  prepareForSummary(text: string): string {
    // HTML要素が含まれているか確認
    if (this.containsHtmlTags(text)) {
      return this.cleanHtml(text);
    }
    
    // プレーンテキストの場合は基本的なクリーニングのみ
    return this.cleanPlainText(text);
  }
  
  /**
   * テキストにHTMLタグが含まれているか確認
   */
  private containsHtmlTags(text: string): boolean {
    return /<\/?[a-z][\s\S]*>/i.test(text);
  }
  
  /**
   * HTMLテキストをクリーニング
   */
  private cleanHtml(html: string): string {
    try {
      const $ = cheerio.load(html);
      
      // コード要素に印をつける
      $('pre, code').each((_, el) => {
        const $el = $(el);
        $el.text(`[コードブロック]: ${$el.text()}`);
      });
      
      // 必要ない要素を削除
      $('script, style, noscript, iframe, svg').remove();
      
      // リンクを処理
      $('a').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const text = $el.text().trim();
        
        if (href && text && href !== text) {
          $el.text(`${text} (リンク)`);
        }
      });
      
      // 画像の代替テキスト
      $('img').each((_, el) => {
        const $el = $(el);
        const alt = $el.attr('alt');
        if (alt) {
          $el.replaceWith(`[画像: ${alt}]`);
        } else {
          $el.replaceWith('[画像]');
        }
      });
      
      // 表を簡略化
      $('table').each((_, el) => {
        const $el = $(el);
        $el.replaceWith('[表が含まれています]');
      });
      
      // 本文テキストを抽出して整形
      let text = $.text();
      
      // 余分な空白を削除
      text = text.replace(/\s+/g, ' ');
      
      // 複数の改行を1つに
      text = text.replace(/\n{3,}/g, '\n\n');
      
      return text.trim();
    } catch (error) {
      console.warn('HTMLパース中にエラーが発生しました。プレーンテキストとして処理します:', error);
      return this.cleanPlainText(html);
    }
  }
  
  /**
   * プレーンテキストをクリーニング
   */
  private cleanPlainText(text: string): string {
    // 余分な空白を削除
    let cleaned = text.replace(/\s+/g, ' ');
    
    // URLをシンプルに
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '[URL]');
    
    // 複数の改行を1つに
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned.trim();
  }
  
  /**
   * 音声用にナレーション済みテキストを最終調整
   */
  prepareForSpeech(text: string): string {
    // 音声合成に不向きな文字を置換
    let speechText = text;
    
    // カッコ内のURLや参照を削除
    speechText = speechText.replace(/\(https?:\/\/[^)]+\)/g, '');
    
    // 英語の記号の前後にスペースを入れて読みやすく
    speechText = speechText.replace(/([.,:;!?])/g, '$1 ');
    
    // 長い記号を置き換え
    speechText = speechText.replace(/---/g, 'ダッシュ');
    speechText = speechText.replace(/--/g, 'ダッシュ');
    
    // 特殊な表記を置き換え
    speechText = speechText.replace(/\[コードブロック\]:/g, 'コードの例として、');
    speechText = speechText.replace(/\[URL\]/g, 'ウェブサイトのアドレス');
    
    // 括弧を音声で区別しやすいように調整
    speechText = speechText.replace(/\(/g, ' （');
    speechText = speechText.replace(/\)/g, '） ');
    
    // 英数字と日本語の間にスペースを入れる
    speechText = speechText.replace(/([a-zA-Z0-9])([ぁ-んァ-ン一-龥])/g, '$1 $2');
    speechText = speechText.replace(/([ぁ-んァ-ン一-龥])([a-zA-Z0-9])/g, '$1 $2');
    
    // 長すぎる文を分割（句点でスピード調整するため）
    speechText = speechText.replace(/([。！？])/g, '$1\n');
    
    // 音声合成エンジンが読みにくい記号を調整
    speechText = speechText.replace(/\+/g, 'プラス');
    speechText = speechText.replace(/\*/g, 'アスタリスク');
    speechText = speechText.replace(/\//g, 'スラッシュ');
    speechText = speechText.replace(/\\/g, 'バックスラッシュ');
    speechText = speechText.replace(/\|/g, 'パイプ');
    speechText = speechText.replace(/\^/g, 'キャレット');
    
    // 余分なスペースを削除
    speechText = speechText.replace(/\s+/g, ' ');
    
    // 改行を調整
    speechText = speechText.replace(/\n{3,}/g, '\n\n');
    
    return speechText.trim();
  }
  
  /**
   * ファイル名から人間が読みやすいタイトルを生成
   */
  generateTitleFromFilename(filename: string): string {
    // 拡張子を削除
    let title = filename.replace(/\.[^/.]+$/, '');
    
    // 数字部分とタイトル部分を分離
    const match = title.match(/^(\d+)[-_\s]+(.+)$/);
    if (match) {
      const [, num, name] = match;
      return `第${num}章 ${name}`;
    }
    
    // 特殊文字を除去
    title = title.replace(/[-_]/g, ' ');
    
    return title;
  }
  
  /**
   * 音声ファイル用にチャプタータイトルを整形
   */
  formatChapterTitle(title: string, index: number): string {
    // 既に章番号が含まれているか確認
    if (/第\s*\d+\s*章/.test(title)) {
      return title;
    }
    
    // narrated_ 接頭辞を削除
    const cleanTitle = title.replace(/^narrated_/i, '');
    
    // 数字とタイトルで構成されているか確認
    const match = cleanTitle.match(/^(\d+)[-_\s]+(.+)$/);
    if (match) {
      const [, num, name] = match;
      return `第${num}章 ${name}`;
    }
    
    // それ以外の場合は与えられたインデックスを使用
    return `第${index+1}章 ${cleanTitle}`;
  }
}

export const textFormatter = new TextFormatter();
