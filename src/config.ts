/**
 * アプリケーション設定
 */
export interface AppConfig {
    // 出力ディレクトリ設定
    outputDir: string;
    // デバッグモード
    debug: boolean;
    // 音声合成設定
    speech: {
        voice: string;
        rate: number;
    };
    // OpenAI API設定
    openai: {
        apiKey: string | undefined;
        model: string;
    };
    // RSS・ポッドキャスト設定
    podcast: {
        baseUrl: string;
        author: string;
        category: string;
        imageUrl?: string;
    };
}

// デフォルト設定 (環境変数からの読み込みを含む)
export const defaultConfig: AppConfig = {
    outputDir: process.env.OUTPUT_DIR || './output',
    debug: process.env.DEBUG === 'true',
    speech: {
        voice: process.env.VOICE_NAME || 'Kyoko', // 日本語（女性）
        rate: process.env.VOICE_RATE ? parseInt(process.env.VOICE_RATE) : 180  // 読み上げ速度
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
    },
    podcast: {
        baseUrl: process.env.PODCAST_BASE_URL || 'https://tech-talk-cast.s3.ap-northeast-1.amazonaws.com',
        author: process.env.PODCAST_AUTHOR || 'TechTalkCast',
        category: process.env.PODCAST_CATEGORY || 'Technology',
        imageUrl: process.env.PODCAST_IMAGE_URL || 'https://tech-talk-cast.s3.ap-northeast-1.amazonaws.com/images/podcast-cover.jpg'
    }
};

// 現在の設定（デフォルト設定をベースに実行時に上書き可能）
export const config: AppConfig = {
    ...defaultConfig
};

// 設定を更新する関数
export function updateConfig(newConfig: Partial<AppConfig>): void {
    Object.assign(config, newConfig);
}
