import * as fs from 'fs';
import * as path from 'path';
import {promisify} from 'util';
import EPub from 'epub';
import {config} from './config';
import {FileManager} from './fileManager';

// EPubの型定義
type EPubType = any;

// EPubライブラリがコールバックベースなので、Promiseでラップ
const openPromise = (filePath: string): Promise<EPubType> => {
    return new Promise((resolve, reject) => {
        const epub = new EPub(filePath);
        epub.on('error', reject);
        epub.on('end', () => {
            resolve(epub);
        });
        epub.parse();
    });
};

// 目次項目の型定義
export interface TocItem {
    id: string;
    title: string;
    level: number;
    order: number;
    href: string;
    children: TocItem[];
}

// チャプター情報の型定義
export interface Chapter {
    id: string;
    title: string;
    href: string;
    order: number;
    content: string;
}

// EPUBファイルを解析するクラス
export class EpubReader {
    private epub: EPubType | null = null;
    private filePath: string;
    private fileName: string;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.fileName = path.basename(filePath, path.extname(filePath));
    }

    /**
     * EPUBファイルを開く
     */
    async open(): Promise<void> {
        try {
            this.epub = await openPromise(this.filePath);
            console.log(`EPUBファイル "${this.fileName}" を開きました`);
        } catch (error) {
            console.error('EPUBファイルを開けませんでした:', error);
            throw error;
        }
    }

    /**
     * 書籍のメタデータを取得
     */
    getMetadata(): any {
        if (!this.epub) throw new Error('EPUBファイルが開かれていません');
        return {
            title: this.epub.metadata.title,
            creator: this.epub.metadata.creator,
            publisher: this.epub.metadata.publisher,
            language: this.epub.metadata.language
        };
    }

    /**
     * 目次（TOC）を取得
     */
    async getToc(): Promise<TocItem[]> {
        if (!this.epub) throw new Error('EPUBファイルが開かれていません');

        // tocプロパティに値がある場合はそれを使用
        if (this.epub.toc && this.epub.toc.length > 0) {
            if (config.debug) {
                console.log('TOCプロパティから目次を取得しました:', JSON.stringify(this.epub.toc, null, 2));
            } else {
                console.log(`TOCプロパティから目次を取得しました (${this.epub.toc.length}項目)`);
            }
            return this.epub.toc;
        }

        // tocがない場合はspine情報からTOCを生成
        const items: TocItem[] = [];

        // flowやspine情報がある場合はそれを使用
        if (this.epub.flow && this.epub.flow.length > 0) {
            console.log('spine情報から目次を生成します');

            // 各スパインアイテムからTOC項目を作成
            for (let i = 0; i < this.epub.flow.length; i++) {
                const item = this.epub.flow[i];

                // スパイン情報に基づいてTOC項目を作成
                items.push({
                    id: item.id,
                    title: item.title || `チャプター ${i + 1}`,
                    href: item.href,
                    level: 0,
                    order: i + 1,
                    children: []
                });
            }

            if (config.debug) {
                console.log('spine情報から目次を生成しました:', JSON.stringify(items, null, 2));
            } else {
                console.log(`spine情報から目次を生成しました (${items.length}項目)`);
            }

            return items;
        }

        // フォールバック: 目次情報が全く取得できない場合
        console.log('警告: 目次情報が見つかりませんでした。EPUB内のコンテンツを直接探索します。');

        // EPUB内のすべてのコンテンツファイルを取得
        if (this.epub.spine && this.epub.spine.contents) {
            const spineIds = Object.keys(this.epub.spine.contents);
            for (let i = 0; i < spineIds.length; i++) {
                const id = spineIds[i];
                items.push({
                    id: id,
                    title: `チャプター ${i + 1}`,
                    href: id,
                    level: 0,
                    order: i + 1,
                    children: []
                });
            }

            console.log(`スパインコンテンツから目次を生成しました (${items.length}項目)`);
            return items;
        }

        console.warn('目次情報をまったく取得できませんでした。');
        return [];
    }

    /**
     * チャプターのコンテンツを取得
     */
    async getChapterContent(chapterId: string): Promise<string> {
        if (!this.epub) throw new Error('EPUBファイルが開かれていません');

        if (!chapterId) {
            console.warn('チャプターIDが空です。スキップします。');
            return '';
        }

        // EPub.jsのgetChapterメソッドをPromiseでラップ
        return new Promise((resolve) => {
            try {
                // まずはgetChapterで取得を試みる
                this.epub!.getChapter(chapterId, (error: Error, text: string) => {
                    if (error || !text) {
                        console.warn(`getChapterでチャプターID "${chapterId}" の取得に失敗しました。getFileを試みます。`);

                        // getChapterが失敗した場合、代わりにgetFileを試す
                        try {
                            this.epub!.getFile(chapterId, (fileError: Error, fileData: Buffer) => {
                                if (fileError || !fileData) {
                                    console.error(`getFileでもチャプターID "${chapterId}" の取得に失敗しました:`, fileError);
                                    resolve('');
                                    return;
                                }

                                // ファイルデータをテキストに変換
                                try {
                                    const content = fileData.toString('utf8');
                                    resolve(content);
                                } catch (decodeError) {
                                    console.error(`ファイルデータの復号化に失敗しました:`, decodeError);
                                    resolve('');
                                }
                            });
                        } catch (getFileError) {
                            console.error(`getFile呼び出し中にエラーが発生しました:`, getFileError);
                            resolve('');
                        }
                        return;
                    }

                    // 正常にコンテンツを取得できた
                    resolve(text);
                });
            } catch (e) {
                console.error(`チャプターID "${chapterId}" の処理中に例外が発生:`, e);
                resolve(''); // エラー時も空のコンテンツを返して処理を続行
            }
        });
    }

    /**
     * 全チャプター情報（内容含む）を取得
     */
    async getAllChapters(): Promise<Chapter[]> {
        if (!this.epub) throw new Error('EPUBファイルが開かれていません');

        const toc = await this.getToc();
        const chapters: Chapter[] = [];
        let order = 1;

        // 再帰的に目次から全チャプターを抽出
        const processItems = async (items: TocItem[], level = 0) => {
            for (const item of items) {
                try {
                    // チャプターIDを決定 (id または href)
                    const chapterId = item.id || item.href;

                    if (!chapterId) {
                        console.warn(`チャプター "${item.title}" はIDまたはhrefがないためスキップします`);
                        continue;
                    }

                    // チャプターの内容を取得
                    const content = await this.getChapterContent(chapterId);

                    // 内容が取得できた場合のみ追加
                    if (content) {
                        chapters.push({
                            id: chapterId,
                            title: item.title || `チャプター ${order}`,
                            href: item.href || chapterId,
                            order: order++,
                            content
                        });
                        console.log(`チャプター "${item.title || chapterId}" の内容を抽出しました`);
                    } else {
                        // IDでダメな場合はhrefを試してみる
                        if (item.href && item.href !== chapterId) {
                            const hrefContent = await this.getChapterContent(item.href);
                            if (hrefContent) {
                                chapters.push({
                                    id: item.href,
                                    title: item.title || `チャプター ${order}`,
                                    href: item.href,
                                    order: order++,
                                    content: hrefContent
                                });
                                console.log(`href経由でチャプター "${item.title || item.href}" の内容を抽出しました`);
                            }
                        }
                    }

                    // 子項目があれば再帰的に処理
                    if (item.children && item.children.length > 0) {
                        await processItems(item.children, level + 1);
                    }
                } catch (error) {
                    console.error(`チャプター処理中にエラーが発生しました:`, error);
                }
            }
        };

        await processItems(toc);

        // チャプターが一つも取得できなかった場合のフォールバック
        if (chapters.length === 0 && this.epub.flow) {
            console.log('目次からチャプターを取得できませんでした。スパイン情報から直接取得を試みます。');

            for (let i = 0; i < this.epub.flow.length; i++) {
                const flowItem = this.epub.flow[i];
                try {
                    const content = await this.getChapterContent(flowItem.id || flowItem.href);
                    if (content) {
                        chapters.push({
                            id: flowItem.id || flowItem.href,
                            title: flowItem.title || `チャプター ${i + 1}`,
                            href: flowItem.href || flowItem.id,
                            order: i + 1,
                            content
                        });
                        console.log(`フローアイテム "${flowItem.title || flowItem.id}" の内容を抽出しました`);
                    }
                } catch (e) {
                    console.error(`フローアイテム ${i} の処理中にエラーが発生しました:`, e);
                }
            }
        }

        return chapters;
    }

    /**
     * ファイル名の取得
     */
    getFileName(): string {
        return this.fileName;
    }

    /**
     * HTMLコンテンツから実際のタイトルを抽出
     */
    private extractTitleFromContent(content: string, fallbackTitle: string): string {
        // h1タグからタイトルを抽出
        const h1Match = content.match(/<h1[^>]*>(.+?)<\/h1>/i);
        if (h1Match) {
            // HTMLタグとアンカータグを除去
            const title = h1Match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (title.length > 0) {
                return title;
            }
        }

        // h1がない場合、h2タグを試す
        const h2Match = content.match(/<h2[^>]*>(.+?)<\/h2>/i);
        if (h2Match) {
            const title = h2Match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (title.length > 0) {
                return title;
            }
        }

        // それでもない場合は、最初の段落から抽出を試みる
        const pMatch = content.match(/<p[^>]*>([^<]{10,100})/i);
        if (pMatch) {
            const title = pMatch[1]
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 50); // 最大50文字
            if (title.length > 10) {
                return title + (pMatch[1].length > 50 ? '...' : '');
            }
        }

        // 全て失敗した場合はフォールバックタイトルを使用
        return fallbackTitle;
    }

    /**
     * コンテンツにh1、h2、またはh3タグが含まれているかチェック
     */
    hasHeadingTags(content: string): boolean {
        const h1Match = /<h1[^>]*>/i.test(content);
        const h2Match = /<h2[^>]*>/i.test(content);
        const h3Match = /<h3[^>]*>/i.test(content);
        return h1Match || h2Match || h3Match;
    }

    /**
     * 読み込んだEPUBの情報をテキストファイルとして保存
     */
    async saveChaptersToFiles(outputDir: string): Promise<void> {
        const chapters = await this.getAllChapters();

        // 出力ディレクトリ作成
        const bookDir = path.join(outputDir, this.fileName);
        if (!fs.existsSync(bookDir)) {
            fs.mkdirSync(bookDir, {recursive: true});
        }

        // メタデータを保存するための配列
        const chaptersMetadata: any[] = [];

        // 各チャプターをテキストファイルとして保存
        for (const chapter of chapters) {
            // コンテンツから実際のタイトルを抽出
            const extractedTitle = this.extractTitleFromContent(chapter.content, chapter.title);
            
            // ファイル名用にタイトルをサニタイズ
            const sanitizedTitle = FileManager.sanitizeFileName(extractedTitle);
            const filename = `${String(chapter.order).padStart(2, '0')}-${sanitizedTitle}.txt`;
            const filePath = path.join(bookDir, filename);

            fs.writeFileSync(filePath, chapter.content, 'utf8');
            console.log(`チャプター "${extractedTitle}" をファイルに保存しました: ${filePath}`);

            // メタデータを記録
            chaptersMetadata.push({
                order: chapter.order,
                fileName: filename,
                originalTitle: chapter.title,
                extractedTitle: extractedTitle
            });
        }

        // メタデータをJSONファイルとして保存
        const metadataPath = path.join(bookDir, 'chapters-metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify({
            bookTitle: this.getMetadata().title,
            chaptersCount: chapters.length,
            chapters: chaptersMetadata
        }, null, 2), 'utf8');

        console.log(`全チャプターを ${bookDir} に保存しました`);
        console.log(`メタデータを ${metadataPath} に保存しました`);
    }
}
