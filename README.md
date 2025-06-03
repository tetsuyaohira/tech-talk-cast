# TechTalkCast

# TechTalkCast

技術書をポッドキャスト風に変換するアプリケーション

## 概要

TechTalkCastは、EPUBフォーマットの技術書を読み込み、以下の処理を行います：

1. EPUB内の各チャプターをテキストファイルとして抽出
2. ChatGPT APIを使用して抽出したテキストを会話調に変換
3. 会話調テキストをmacOSのsayコマンドで音声ファイル化
4. 各チャプターごとの音声ファイルと、全チャプターを結合した完全版の音声ファイルを生成
5. 完全版にはチャプター情報を埋め込み（M4A形式）

これにより、難解な技術書を通勤・通学中や家事の合間などに「聴く」ことができるようになります。

## インストール

技術書（主にEPUB形式）を読み取り、要約してポッドキャスト風に変換するアプリケーション。

## 機能

- EPUBファイルの読み込み
- 目次（チャプター情報）の抽出
- チャプターごとの本文抽出
- ChatGPTを使用した要約
- sayコマンドを使用した音声合成

## 必要条件

- Node.js (v20以上推奨)
- TypeScript
- macOS（sayコマンドを使用するため）

## インストール方法

```bash
# リポジトリのクローン（または任意の方法でダウンロード）
git clone https://github.com/yourusername/tech-talk-cast.git
cd tech-talk-cast

# 依存パッケージのインストール
npm install
```

## 実行方法

```bash
# 基本的な実行方法（--が必要です）
npm run dev -- "./books/ソフトウェアアーキテクチャの基礎.epub"

# オプション付きの実行
npm run dev -- "./books/ソフトウェアアーキテクチャの基礎.epub" --no-gpt
npm run dev -- "./books/ソフトウェアアーキテクチャの基礎.epub" --no-speech
npm run dev -- "./books/ソフトウェアアーキテクチャの基礎.epub" --no-gpt --no-speech

# 既存の_narratedフォルダから音声生成のみ行う場合
npm run dev -- "./books/ソフトウェアアーキテクチャの基礎.epub" --no-gpt

# 既存の音声ファイルから完全版のみ再生成（チャプター付きM4A形式）
npm run dev -- "./books/ソフトウェアアーキテクチャの基礎.epub" --combine-only
```

### オプション説明

- `--no-gpt`: ChatGPT APIによる要約処理をスキップ
- `--no-speech`: 音声合成処理をスキップ
- `--no-rss`: RSSフィード生成をスキップ
- `--combine-only`: 既存の個別音声ファイルから完全版のみを再生成（チャプター情報付きM4A形式）
- `--debug`: デバッグモードを有効化

## mp3への変換

```bash
cd ./output/ソフトウェアアーキテクチャの基礎_audio
for f in *.aiff; do
  ffmpeg -i "$f" -codec:a libmp3lame -b:a 192k "${f%.aiff}.mp3"
done
```