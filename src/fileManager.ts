import * as fs from 'fs';
import * as path from 'path';
import {config} from './config';

/**
 * ファイル操作を管理するクラス
 */
export class FileManager {
    /**
     * EPUBファイルの存在を確認
     */
    static validateEpubFile(filePath: string): boolean {
        if (!fs.existsSync(filePath)) {
            console.error(`エラー: ファイル "${filePath}" が見つかりません`);
            return false;
        }

        if (!filePath.toLowerCase().endsWith('.epub')) {
            console.error(`エラー: "${filePath}" はEPUBファイルではありません`);
            return false;
        }

        return true;
    }

    /**
     * 出力ディレクトリの存在を確認し、なければ作成
     */
    static ensureOutputDirectory(): void {
        if (!fs.existsSync(config.outputDir)) {
            try {
                fs.mkdirSync(config.outputDir, {recursive: true});
                console.log(`出力ディレクトリを作成しました: ${config.outputDir}`);
            } catch (error) {
                console.error(`出力ディレクトリの作成に失敗しました: ${error}`);
                throw error;
            }
        }
    }

    /**
     * 書籍ディレクトリを作成
     */
    static createBookDirectory(bookName: string): string {
        const bookDir = path.join(config.outputDir, bookName);

        if (!fs.existsSync(bookDir)) {
            try {
                fs.mkdirSync(bookDir, {recursive: true});
            } catch (error) {
                console.error(`書籍ディレクトリの作成に失敗しました: ${error}`);
                throw error;
            }
        }

        return bookDir;
    }

    /**
     * テキストファイルの保存
     */
    static saveTextToFile(content: string, filePath: string): void {
        try {
            // ディレクトリが存在することを確認
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, {recursive: true});
            }

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`ファイルを保存しました: ${filePath}`);
        } catch (error) {
            console.error(`ファイル保存中にエラーが発生しました (${filePath}):`, error);
            throw error;
        }
    }

    /**
     * ファイルを安全に書き込み（ディレクトリがなければ作成）
     */
    static writeFile(filePath: string, content: string | Buffer): void {
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }

        fs.writeFileSync(filePath, content);
    }

    /**
     * ファイルパスの安全な生成（ファイル名に使えない文字を置換）
     */
    static createSafeFilePath(dir: string, filename: string, extension: string): string {
        // ファイル名に使えない文字を置換
        const safeFilename = filename.replace(/[\\/:*?"<>|]/g, '_');
        return path.join(dir, `${safeFilename}.${extension}`);
    }

    /**
     * ファイルをコピー
     */
    static copyFile(sourcePath: string, targetPath: string): void {
        const targetDir = path.dirname(targetPath);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, {recursive: true});
        }

        fs.copyFileSync(sourcePath, targetPath);
    }

    /**
     * ディレクトリ内のすべてのファイルを取得（再帰的にサブディレクトリも）
     */
    static getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
        const files = fs.readdirSync(dirPath);

        files.forEach(file => {
            const fullPath = path.join(dirPath, file);

            if (fs.statSync(fullPath).isDirectory()) {
                arrayOfFiles = this.getAllFiles(fullPath, arrayOfFiles);
            } else {
                arrayOfFiles.push(fullPath);
            }
        });

        return arrayOfFiles;
    }

    /**
     * ディレクトリ内のファイルをフィルタリング
     */
    static getFilesWithExtension(dirPath: string, extension: string): string[] {
        if (!fs.existsSync(dirPath)) {
            return [];
        }

        const allFiles = this.getAllFiles(dirPath);
        return allFiles.filter(file => file.endsWith(extension));
    }

    /**
     * 指定されたディレクトリのサイズを取得（バイト単位）
     */
    static getDirSize(dirPath: string): number {
        const files = this.getAllFiles(dirPath);
        let size = 0;

        files.forEach(file => {
            const stats = fs.statSync(file);
            size += stats.size;
        });

        return size;
    }

    /**
     * バイト数を人間が読みやすい形式に変換
     */
    static formatSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
}