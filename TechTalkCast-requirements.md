# 📚要件定義書 ＆ ソフトウェアアーキテクチャ設計書

## 1. プロジェクト概要

- 技術書（主にepub形式）を読み取り、ChatGPTで「友達に教えるような会話形式」に要約。
- さらに、要約テキストをsayコマンドで合成音声ファイル化し、ポッドキャスト的に聴けるようにするプログラムを作成する。

## 2. 背景・目的

- 技術書をそのまま読み上げても頭に入りにくいため、要約＆会話調変換して音声で聴きたい
- ソースコードやURLはそのまま読まれるとノイズになるため、自然な表現に意訳 or 無視する
- 隙間時間にポッドキャスト感覚で学習できるようにする

## 3. 要件

### 3.1 入力仕様

| 項目         | 内容                                 |
|------------|------------------------------------|
| ファイル形式     | .epub                              |
| ファイル指定方法   | ユーザーがファイルパスを指定（コマンドライン引数 or 対話式選択） |
| 文字エンコーディング | UTF-8前提                            |
| チャプター管理    | 目次（TOC）ありepubファイルから章・節ごとに本文抽出      |

### 3.2 出力仕様

| 項目       | 内容                                      |
|----------|-----------------------------------------|
| 音声ファイル形式 | .mp3（.aiffから変換）                         |
| 保存先      | 入力ファイルと同じ階層 or 指定ディレクトリに本の名前/フォルダを作成    |
| ファイル名ルール | - 全体音声：本の名前_完全版.mp3- チャプター単位：01-第1章.mp3 |
| 音声内容     | 要約されたチャプター単位の会話風文章                      |
| テキスト保存   | 任意オプション。要約されたテキストも.txt保存可               |

## 4. ソフトウェアアーキテクチャ

### 4.1 言語・ランタイム

- Node.js (v20以上推奨)
- TypeScript使用（型安全、開発効率向上）

### 4.2 外部サービス・ライブラリ

| 目的            | 使用予定ライブラリ                 |
|---------------|---------------------------|
| epub解析        | epub npmパッケージ or epub2    |
| ChatGPT API通信 | axios or openai SDK       |
| ファイル操作        | Node標準fsモジュール             |
| コマンド実行        | Node標準child_processモジュール  |
| ログ表示          | consoleベース（必要に応じてchalkなど） |

### 4.3 外部ツール

| ツール            | 用途             |
|----------------|----------------|
| macOS say コマンド | テキストから音声ファイル作成 |
| ffmpeg         | AIFFからMP3への変換  |

## 5. モジュール構成

### 5.1 モジュール一覧

| ファイル名                | 役割                        |
|----------------------|---------------------------|
| index.ts             | エントリーポイント。全体の流れ制御         |
| epubReader.ts        | epubファイルの読込、目次取得、本文抽出     |
| summarizer.ts        | ChatGPT APIとのやり取り、要約取得    |
| textFormatter.ts     | ソースコード意訳、URL除去、聞きやすい文への整形 |
| speechSynthesizer.ts | sayコマンドを使った音声ファイル生成       |
| fileManager.ts       | 出力先ディレクトリ/ファイルの管理、保存処理    |
| config.ts            | APIキー、音声オプションなど環境設定の管理    |

### 5.2 モジュール依存関係

```
index.ts
├── epubReader.ts
├── summarizer.ts
│    └── textFormatter.ts
├── speechSynthesizer.ts
└── fileManager.ts
      └── config.ts
```

## 6. 処理フロー

```
ユーザー
  ↓ epubファイル指定
Node.jsアプリ
  ↓ 目次（チャプター情報）抽出
  ↓ チャプターごとに本文抽出
  ↓ ChatGPT APIに要約リクエスト
  ↓ 要約結果をテキスト整形
  ↓ テキストから音声ファイル作成
  ↓ 音声ファイル保存
  ↓ 完了メッセージ
```

## 7. コーディングにあたっての補足・注意点

- APIキーや機密情報は.envなど別管理を推奨
- チャプター単位で並列処理してもよいが、初期版は順次処理（直列）推奨
- 目次がないepubの場合は簡易チャプター分割（例えばファイルサイズやページ数ベース）を行うか、警告出して終了
- sayコマンドは初期版では標準設定使用。音声速度、声の種類指定はオプション指定できるよう拡張可能。
- ログは最低限、ファイルごとの進捗（開始/完了）が出るようにする
- エラー発生時（例：API失敗、say失敗など）はエラーハンドリングしてリトライやスキップ可能な設計にする
