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
     * 音声ファイルディレクトリからエピソード情報を生成
     */
    async createEpisodesFromAudioDir(audioDir: string, bookName: string): Promise<PodcastEpisode[]> {
        const episodes: PodcastEpisode[] = [];

        try {
            const files = fs.readdirSync(audioDir);
            const mp3Files = files.filter(file => file.endsWith('.mp3'));

            // 完全版ファイルを最初に追加
            const completeFile = mp3Files.find(file => file.includes('完全版'));
            if (completeFile) {
                const stats = fs.statSync(path.join(audioDir, completeFile));
                episodes.push({
                    title: `${bookName} - 完全版`,
                    description: `「${bookName}」の全章を通して聞ける完全版です。`,
                    audioUrl: `${this.baseUrl}/audio/${this.sanitizeFileName(bookName)}/${completeFile}`,
                    pubDate: new Date().toUTCString(),
                    fileSize: stats.size,
                    duration: await this.getAudioDuration(path.join(audioDir, completeFile)),
                    chapterNumber: 0
                });
            }

            // チャプター別ファイルを追加
            const chapterFiles = mp3Files
                .filter(file => !file.includes('完全版'))
                .sort((a, b) => {
                    const numA = this.extractChapterNumber(a);
                    const numB = this.extractChapterNumber(b);
                    return numA - numB;
                });

            // 総チャプター数を取得
            const totalChapters = chapterFiles.length;

            for (const file of chapterFiles) {
                const chapterMatch = file.match(/(?:narrated_)?(\d+)-(.+)\.mp3$/);
                if (chapterMatch) {
                    const [, chapterNum, chapterName] = chapterMatch;
                    const stats = fs.statSync(path.join(audioDir, file));
                    
                    // 第1章を最も古く、最終章を新しくする
                    // 完全版より古い日付にするため、totalChapters + 1から引く
                    const daysAgo = totalChapters - parseInt(chapterNum) + 2;
                    
                    episodes.push({
                        title: `第${chapterNum}章: ${chapterName.replace(/_/g, ' ')}`,
                        description: `「${bookName}」第${chapterNum}章の内容をポッドキャスト形式でお届けします。`,
                        audioUrl: `${this.baseUrl}/audio/${this.sanitizeFileName(bookName)}/${file}`,
                        pubDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toUTCString(),
                        fileSize: stats.size,
                        duration: await this.getAudioDuration(path.join(audioDir, file)),
                        chapterNumber: parseInt(chapterNum)
                    });
                }
            }

            return episodes;
        } catch (error) {
            console.error(chalk.red(`音声ディレクトリの読み込みエラー: ${error}`));
            return [];
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
     * 書籍からポッドキャストを生成
     */
    async generatePodcastFromBook(
        bookName: string, 
        audioDir: string, 
        outputDir: string,
        options: {
            author?: string;
            description?: string;
            category?: string;
            imageUrl?: string;
        } = {}
    ): Promise<string> {
        try {
            // エピソード情報を生成
            const episodes = await this.createEpisodesFromAudioDir(audioDir, bookName);

            if (episodes.length === 0) {
                throw new Error('音声ファイルが見つかりません');
            }

            // ポッドキャスト情報を作成
            const podcastInfo: PodcastInfo = {
                title: `TechTalkCast: ${bookName}`,
                description: options.description || `技術書「${bookName}」をポッドキャスト形式で配信。通勤・通学のお供にどうぞ！`,
                author: options.author || 'TechTalkCast',
                category: options.category || 'Technology',
                language: 'ja',
                link: this.baseUrl,
                imageUrl: options.imageUrl,
                episodes: episodes
            };

            // RSSを生成
            const rssContent = this.generateRSS(podcastInfo);
            
            // RSSファイルを保存
            const rssFileName = `${this.sanitizeFileName(bookName)}-podcast.xml`;
            const rssPath = path.join(outputDir, rssFileName);
            
            fs.writeFileSync(rssPath, rssContent, 'utf-8');
            
            console.log(chalk.green(`📻 RSSフィードを生成しました: ${rssPath}`));
            console.log(chalk.blue(`📱 配信URL: ${this.baseUrl}/feeds/${rssFileName}`));
            console.log(chalk.blue(`🎧 エピソード数: ${episodes.length}`));

            return rssPath;
        } catch (error) {
            console.error(chalk.red(`RSS生成エラー: ${error}`));
            throw error;
        }
    }
}

/**
 * RSS生成のメイン関数
 */
export async function generatePodcastRSS(
    bookName: string, 
    outputDir: string, 
    baseUrl: string,
    options?: {
        author?: string;
        description?: string;
        category?: string;
        imageUrl?: string;
    }
): Promise<string> {
    const audioDir = path.join(outputDir, `${bookName}_audio`);
    
    if (!fs.existsSync(audioDir)) {
        throw new Error(`音声ディレクトリが見つかりません: ${audioDir}`);
    }

    const rssGenerator = new RSSGenerator(baseUrl);
    return await rssGenerator.generatePodcastFromBook(bookName, audioDir, outputDir, options);
}
