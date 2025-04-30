import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {config} from './config';
import {textFormatter} from './textFormatter';

interface SummaryOptions {
    model?: string;
    temperature?: number;
    maxLength?: number;
}

export class Summarizer {
    private apiKey: string;
    private defaultModel = 'gpt-3.5-turbo';
    private defaultTemperature = 0.7;
    private defaultMaxLength = 4000;

    constructor() {
        // 環境変数からAPIキーを取得
        this.apiKey = process.env.OPENAI_API_KEY || '';

        if (!this.apiKey) {
            console.warn('警告: OPENAI_API_KEYが設定されていません。環境変数で設定してください。');
        }
    }

    /**
     * テキストをChatGPT APIで要約・変換
     */
    async summarizeText(text: string, options: SummaryOptions = {}): Promise<string> {
        if (!this.apiKey) {
            throw new Error('OPENAI_API_KEYが設定されていません。');
        }

        // フォーマッターで前処理
        const formattedText = textFormatter.prepareForSummary(text);

        // オプションの設定
        const model = options.model || this.defaultModel;
        const temperature = options.temperature || this.defaultTemperature;
        const maxLength = options.maxLength || this.defaultMaxLength;

        // テキストが長すぎる場合は分割
        if (formattedText.length > maxLength) {
            console.log(`テキストが長すぎるため、${maxLength}文字ごとに分割して処理します。`);
            return this.summarizeLongText(formattedText, options);
        }

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: model,
                    messages: [
                        {
                            role: 'system',
                            content: `あなたは、技術書を音声用コンテンツに変換するナレーション編集者です。

以下の入力テキストは、技術書の「まえがき」や「章の本文」などです。
この内容を元に、Podcastでナレーターが読み上げるような、友達に説明する感じの会話調のテキストに変換してください。

### 制約とルール：

- フランクで親しみやすい口調にしてください（例：「〜なんだよね」「って話」など）
- 一般のエンジニアが聞いて理解できるようにしてください（専門用語は補足 or 言い換えOK）
- ソースコードやURLが含まれていた場合は、読み上げに適した表現に言い換えてください（読み上げる必要がない場合は説明だけでもOK）
- 難解な文は、シンプルに分解してください
- 音声で聞いて自然な流れになるように、語順や文の切り方を工夫してください

出力は、音声用ナレーションとしてそのまま使える自然な日本語の文章にしてください。`
                        },
                        {
                            role: 'user',
                            content: formattedText
                        }
                    ],
                    temperature: temperature,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    }
                }
            );

            // レスポンスから要約テキストを取得
            const summary = response.data.choices[0].message.content;

            if (config.debug) {
                console.log('APIレスポンス:', JSON.stringify(response.data, null, 2));
            }

            return summary;
        } catch (error) {
            console.error('ChatGPT API呼び出し中にエラーが発生しました:', error);
            if (axios.isAxiosError(error) && error.response) {
                console.error('APIレスポンス:', error.response.data);
            }
            throw new Error('テキストの要約に失敗しました');
        }
    }

    /**
     * 長いテキストを分割してAPIに送信し、結果を結合
     */
    private async summarizeLongText(text: string, options: SummaryOptions = {}): Promise<string> {
        const maxLength = options.maxLength || this.defaultMaxLength;

        // テキストをチャンクに分割（段落を尊重）
        const chunks = this.splitTextIntoChunks(text, maxLength);
        console.log(`テキストを${chunks.length}個のチャンクに分割しました。`);

        // 各チャンクを個別に要約
        const summaries: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
            console.log(`チャンク ${i + 1}/${chunks.length} を処理中...`);
            const chunkSummary = await this.summarizeText(chunks[i], {
                ...options,
                maxLength: maxLength * 2 // 分割後はまとめて処理できるよう余裕を持たせる
            });
            summaries.push(chunkSummary);
        }

        // 最終的な結合
        return summaries.join('\n\n');
    }

    /**
     * テキストを適切なサイズのチャンクに分割
     */
    private splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
        const chunks: string[] = [];
        const paragraphs = text.split(/\n\s*\n/); // 空行で段落を分割

        let currentChunk = '';

        for (const paragraph of paragraphs) {
            // 現在のチャンクに段落を追加するとサイズを超える場合
            if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
                // 現在のチャンクが空でない場合は追加
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }

                // 段落自体が最大サイズを超える場合は分割
                if (paragraph.length > maxChunkSize) {
                    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/);
                    let sentenceChunk = '';

                    for (const sentence of sentences) {
                        if (sentenceChunk.length + sentence.length + 1 > maxChunkSize) {
                            chunks.push(sentenceChunk);
                            sentenceChunk = sentence;
                        } else {
                            sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
                        }
                    }

                    if (sentenceChunk.length > 0) {
                        currentChunk = sentenceChunk;
                    }
                } else {
                    currentChunk = paragraph;
                }
            } else {
                // チャンクに段落を追加
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            }
        }

        // 最後のチャンクを追加
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * チャプターテキストをAPIで処理し、結果をファイルに保存
     */
    async processChapterFile(inputFilePath: string, outputFilePath: string): Promise<void> {
        try {
            // ファイルからテキストを読み込み
            const text = fs.readFileSync(inputFilePath, 'utf8');
            console.log(`ファイル "${path.basename(inputFilePath)}" を読み込みました (${text.length} 文字)`);

            // APIで要約
            console.log('ChatGPT APIでテキストを処理中...');
            const summary = await this.summarizeText(text);

            // 結果をファイルに保存
            fs.writeFileSync(outputFilePath, summary, 'utf8');
            console.log(`変換結果を "${outputFilePath}" に保存しました`);

            return;
        } catch (error) {
            console.error(`ファイル "${inputFilePath}" の処理中にエラーが発生しました:`, error);
            throw error;
        }
    }

    /**
     * ディレクトリ内の複数チャプターを一括処理
     */
    async processAllChapters(inputDir: string, outputDir: string): Promise<string[]> {
        // 入力ディレクトリのファイル一覧を取得
        const files = fs.readdirSync(inputDir)
            .filter(file => file.endsWith('.txt'))
            .sort(); // 名前順にソート

        // 出力ディレクトリの作成
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
        }

        const processedFiles: string[] = [];

        // 各ファイルを処理
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const inputFilePath = path.join(inputDir, file);
            const outputFilePath = path.join(outputDir, `narrated_${file}`);

            try {
                console.log(`[${i + 1}/${files.length}] ファイル処理中: ${file}`);
                await this.processChapterFile(inputFilePath, outputFilePath);
                processedFiles.push(outputFilePath);
            } catch (error) {
                console.error(`ファイル "${file}" の処理を省略します:`, error);
            }

        }

        return processedFiles;
    }
}
