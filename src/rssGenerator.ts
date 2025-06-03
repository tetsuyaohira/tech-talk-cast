import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface PodcastEpisode {
    title: string;
    description: string;
    audioUrl: string;
    pubDate: string;
    duration?: string;
    fileSize?: number;
    chapterNumber?: number;
}

interface PodcastInfo {
    title: string;
    description: string;
    author: string;
    category: string;
    imageUrl?: string;
    language: string;
    link: string;
    episodes: PodcastEpisode[];
}

/**
 * RSS 2.0フィード生成クラス
 */
export class RSSGenerator {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * RSS XMLを生成
     */
    generateRSS(podcastInfo: PodcastInfo): string {
        const rssHeader = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title><![CDATA[${podcastInfo.title}]]></title>
    <description><![CDATA[${podcastInfo.description}]]></description>
    <language>${podcastInfo.language}</language>
    <copyright>© ${new Date().getFullYear()} ${podcastInfo.author}</copyright>
    <itunes:author>${podcastInfo.author}</itunes:author>
    <itunes:category text="${podcastInfo.category}"/>
    <itunes:explicit>false</itunes:explicit>
    ${podcastInfo.imageUrl ? `<itunes:image href="${podcastInfo.imageUrl}"/>` : ''}
    <link>${podcastInfo.link}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`;

        const episodes = podcastInfo.episodes
            .map(episode => this.generateEpisodeXML(episode))
            .join('\n');
        
        const rssFooter = `  </channel>\n</rss>`;

        return `${rssHeader}\n${episodes}\n${rssFooter}`;
    }

    /**
     * 個別エピソードのXMLを生成
     */
    private generateEpisodeXML(episode: PodcastEpisode): string {
        return `    <item>
      <title><![CDATA[${episode.title}]]></title>
      <description><![CDATA[${episode.description}]]></description>
      <enclosure url="${episode.audioUrl}" type="audio/mpeg" ${episode.fileSize ? `length="${episode.fileSize}"` : 'length="1"'}/>
      <pubDate>${episode.pubDate}</pubDate>
      <itunes:duration>${episode.duration || '00:00:00'}</itunes:duration>
      <guid>${episode.audioUrl}</guid>
    </item>`;
    }

    /**
     * 完全版ファイルからエピソード情報を生成（本単位）
     */
    async createEpisodeFromCompleteFile(
        completeFilePath: string, 
        bookName: string,
        duration?: string
    ): Promise<PodcastEpisode | null> {
        try {
            if (!fs.existsSync(completeFilePath)) {
                console.error(chalk.red(`完全版ファイルが見つかりません: ${completeFilePath}`));
                return null;
            }

            const stats = fs.statSync(completeFilePath);
            const fileName = path.basename(completeFilePath);
            
            return {
                title: bookName,
                description: `技術書「${bookName}」の完全版。全章を通して聞くことができます。`,
                audioUrl: `${this.baseUrl}/audio/${fileName}`,
                pubDate: new Date().toUTCString(),
                fileSize: stats.size,
                duration: duration || await this.getAudioDuration(completeFilePath)
            };
        } catch (error) {
            console.error(chalk.red(`エピソード情報の生成エラー: ${error}`));
            return null;
        }
    }

    /**
     * ファイル名からチャプター番号を抽出
     */
    private extractChapterNumber(filename: string): number {
        const match = filename.match(/(?:narrated_)?(\d+)-/);
        return match ? parseInt(match[1]) : 999;
    }

    /**
     * 音声ファイルの長さを取得（現在は固定値、実装時はffprobeを使用）
     */
    private async getAudioDuration(filePath: string): Promise<string> {
        // TODO: ffprobeを使用して実際の長さを取得
        // 現在は固定値を返す
        try {
            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            // 概算: 1MBあたり約30秒（192kbps想定）
            const estimatedSeconds = Math.round(fileSizeMB * 30);
            const minutes = Math.floor(estimatedSeconds / 60);
            const seconds = estimatedSeconds % 60;
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:00`;
        } catch {
            return '00:30:00';
        }
    }

    /**
     * ファイル名をURL安全な形式に変換
     */
    private sanitizeFileName(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
    }

    /**
     * 完全版ファイルから個別RSSを生成（本単位）
     */
    async generateIndividualRSS(
        bookName: string, 
        completeFilePath: string, 
        outputDir: string,
        options: {
            author?: string;
            description?: string;
            category?: string;
            imageUrl?: string;
            duration?: string;
        } = {}
    ): Promise<string> {
        try {
            // エピソード情報を生成（1エピソードのみ）
            const episode = await this.createEpisodeFromCompleteFile(completeFilePath, bookName, options.duration);

            if (!episode) {
                throw new Error('エピソード情報の生成に失敗しました');
            }

            // ポッドキャスト情報を作成（個別RSS用にコメント付き）
            const podcastInfo: PodcastInfo = {
                title: 'TechTalkCast',
                description: '技術書をポッドキャスト形式で配信。通勤・通学のお供にどうぞ！',
                author: options.author || 'TechTalkCast',
                category: options.category || 'Technology',
                language: 'ja',
                link: this.baseUrl,
                imageUrl: options.imageUrl,
                episodes: [episode]
            };

            // 個別RSS用のテンプレートを生成
            const rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 
  このファイルは「${bookName}」の個別RSSです。
  配信用のpodcast.xmlに統合する場合は、以下の<item>要素をコピーしてください。
-->
${this.generateRSS(podcastInfo)}`;
            
            // RSSファイルを保存（音声ファイルと同じディレクトリ）
            const audioDir = path.dirname(completeFilePath);
            const rssFileName = `${bookName}.rss.xml`;
            const rssPath = path.join(audioDir, rssFileName);
            
            fs.writeFileSync(rssPath, rssContent, 'utf-8');
            
            console.log(chalk.green(`📻 個別RSSフィードを生成しました: ${rssPath}`));
            console.log(chalk.yellow(`📝 配信用podcast.xmlに統合する際は、<item>要素をコピーしてください`));

            return rssPath;
        } catch (error) {
            console.error(chalk.red(`RSS生成エラー: ${error}`));
            throw error;
        }
    }
}

/**
 * 完全版ファイルから個別RSSを生成（本単位）
 */
export async function generatePodcastRSS(
    bookName: string, 
    completeFilePath: string, 
    baseUrl: string,
    options?: {
        author?: string;
        description?: string;
        category?: string;
        imageUrl?: string;
        duration?: string;
    }
): Promise<string> {
    if (!fs.existsSync(completeFilePath)) {
        throw new Error(`完全版ファイルが見つかりません: ${completeFilePath}`);
    }

    const outputDir = path.dirname(completeFilePath);
    const rssGenerator = new RSSGenerator(baseUrl);
    return await rssGenerator.generateIndividualRSS(bookName, completeFilePath, outputDir, options);
}
