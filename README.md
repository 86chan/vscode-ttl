# TTL - Tera Term Language Support for VS Code

*[English](README.en.md) | 日本語*

[Tera Term](https://teratermproject.github.io/) のマクロ言語 TTL (Tera Term Language) に対応した VS Code 拡張機能です。

> Tera Term は [TeraTerm Project](https://github.com/TeraTermProject/teraterm) の著作物です。本拡張は非公式であり、TeraTerm Project とは関係ありません。

## 機能

- **シンタックスハイライト** — キーワード・コマンド・文字列・コメント・ラベル・演算子・システム変数
- **コード補完** — 201 個の組み込みコマンドをシグネチャ付きで補完
- **ホバードキュメント** — コマンド上にカーソルを置くと日本語または英語のリファレンスを表示
- **定義ジャンプ** — `goto`/`call` のラベル参照から `:label` 定義行へジャンプ。同一ファイルに無ければ `include` 先（再帰的に）も探索 (F12)
- **参照検索** — ラベルの定義・参照（`goto`/`call`）の一覧を表示 (Shift+F12)
- **アウトライン / シンボル** — ラベル定義と `include` をパンくず・アウトライン・シンボル検索（Ctrl+Shift+O）に表示
- **include リンク** — `include 'path'` のパスを Ctrl+クリックで開く。Tera Term と同じく、相対パスは**最上位の親マクロ**のディレクトリを基準に解決（ワークスペースを走査して親を自動検出。`ttl.includeRootDir` で固定も可能）
- **マクロ実行（デバッグ構成）** — `launch.json` の「構成の追加」に **TTL Macro (Tera Term)** が並び、F5 / ▶ で現在のマクロを Tera Term で実行。接続（SSH/Telnet/シリアル）を構造化した `connect` で指定（[使い方](#マクロ実行)）
- **コード整形** — `if`/`for`/`while`/`do` などのブロック構造に応じて自動インデント。演算子・カンマまわりの空白を正規化（`a=1` → `a = 1`、文字列・コメント・負数は保持）。連続する空行を圧縮。コメント内に書かれた Markdown テーブルも全角文字を考慮して桁揃え (Shift+Alt+F)。コマンドパレットの **TTL: ワークスペース内のすべての TTL ファイルを整形** でファイルを選んで一括整形も可能
- **診断（エラー/警告）** — 無効な演算子（`&&`/`++`/`+=` など）、システム変数（`result` など）への代入、条件式での単独 `=`（比較は `==` を推奨）、ブロックの閉じ忘れ（`endif`/`next` など）、深すぎるネスト（既定 2 段）、未知のコマンド（近いコマンドを提案）、未定義ラベルへの `goto`/`call`（include 先も解決）、重複したラベル定義を検出

## 言語設定

VS Code の UI 言語を自動検出して日本語・英語を切り替えます。設定で固定することも可能です。

```json
"ttl.language": "auto"  // "auto" | "ja" | "en"
```

ネスト警告の上限段数も設定できます（既定 2、0 で無効化）。

```json
"ttl.maxNestingDepth": 2
```

個別の診断は設定で無効化できます（いずれも既定 true）。

```json
"ttl.diagnostics.undefinedLabel": true,
"ttl.diagnostics.unknownCommand": true,
"ttl.diagnostics.duplicateLabel": true
```

コード整形の挙動も設定でカスタマイズできます。`maxConsecutiveBlankLines` は保持する連続空行の最大数（0 で圧縮を無効化）です。

```json
"ttl.format.normalizeOperatorSpacing": true,  // 演算子・カンマまわりの空白を正規化
"ttl.format.alignCommentTables": true,        // コメント内 Markdown テーブルの桁揃え
"ttl.format.maxConsecutiveBlankLines": 1      // 連続空行の許容上限（0 で無制限）
```

ラベルを同一ファイル内で完結させたい場合は次の設定を有効にします（既定 false）。有効時は `include` 先のラベルを受理せず、定義ジャンプ（F12）も同一ファイル内のみを探索し、同一ファイル内に定義の無い `goto`/`call` をエラーとして報告します（エラー診断は `ttl.diagnostics.undefinedLabel` が有効な場合のみ）。

```json
"ttl.requireLabelInSameFile": false
```

include リンクの解決基準ディレクトリを固定できます。空（既定）の場合はワークスペースを走査して最上位の親マクロを自動検出します。相対パスはワークスペースフォルダ基準、絶対パスはそのまま使用します。

```json
"ttl.includeRootDir": ""
```

## マクロ実行

`launch.json` のデバッグ構成として実行します。**実行とデバッグ** パネルで「launch.json ファイルを作成」→ **TTL Macro (Tera Term)** を選ぶか、`launch.json` の「構成の追加」から追加します。F5 または ▶ で起動します（Windows + Tera Term が必要）。

接続は構造化した `connect` オブジェクトで記述し、拡張が Tera Term の CLI オプションに変換します。`connect` を省略すると接続せずに起動し、接続はマクロ内の `connect` に委ねます。

```jsonc
// SSH
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro (SSH)",
  "program": "${file}",            // 実行するマクロ
  "connect": {
    "proto": "ssh",                // "ssh" | "telnet" | "serial"
    "host": "192.168.0.100",
    "port": 22,
    "options": ["/auth=password", "/user=admin"]  // 追加の生オプション
  },
  "teraTermDir": ""                 // 空なら自動探索
}
// → ttermpro.exe 192.168.0.100:22 /ssh /auth=password /user=admin /M=<file>
```

```jsonc
// シリアル
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro (Serial)",
  "program": "${file}",
  "connect": {
    "proto": "serial",
    "comport": 3,        // COM ポート番号 (1–256)
    "speed": 115200,     // ボーレート
    "cdatabit": 8,       // 7 | 8
    "cparity": "none",   // none | odd | even | mark | space
    "cstopbit": 1,       // 1 | 1.5 | 2
    "cflowctrl": "hard"  // x | hard | none | rtscts | dsrdtr
  }
}
// → ttermpro.exe /C=3 /BAUD=115200 /CDATABIT=8 /CPARITY=none /CSTOPBIT=1 /CFLOWCTRL=hard /M=<file>
```

`connect.host` に `${input:ttlHost}` を指定し、`launch.json` に `inputs` を足せば、実行時に接続先を入力できます。

```jsonc
{
  "configurations": [
    { "type": "ttl", "request": "launch", "name": "Run TTL Macro (prompt host)",
      "program": "${file}", "connect": { "proto": "ssh", "host": "${input:ttlHost}", "port": 22 } }
  ],
  "inputs": [
    { "id": "ttlHost", "type": "promptString", "description": "接続先 (例: 192.168.0.100)" }
  ]
}
```

### その他のオプション

接続以外の Tera Term 起動オプションも構成のトップレベルに指定できます（説明は VS Code の表示言語で日本語/英語に切り替わります）。

| 構成キー | Tera Term | 説明 |
|---|---|---|
| `windowTitle` | `/W=` | ウィンドウタイトル |
| `setupFile` | `/F=` | 設定ファイル |
| `keyboardFile` | `/K=` | キーボード設定 |
| `logFile` / `noLog` | `/L=` / `/NOLOG` | ログ開始 / 開始しない |
| `replayFile` | `/R=` | 再生ファイル |
| `fileTransferDir` | `/FD=` | 転送ディレクトリ |
| `theme` | `/THEME=` | テーマ |
| `vtIcon` / `tekIcon` | `/VTICON=` / `/TEKICON=` | ウィンドウアイコン |
| `hideTitleBar` / `iconify` / `hidden` | `/H` / `/I` / `/V` | タイトルバー非表示 / アイコン化 / 非表示起動 |
| `windowX` / `windowY` | `/X=` / `/Y=` | ウィンドウ位置 |
| `kanjiReceive` / `kanjiTransmit` | `/KR=` / `/KT=` | 漢字コード 受信/送信 |
| `multicastName` | `/MN=` | マルチキャスト名 |
| `osc52` | `/OSC52=` | クリップボード許可操作 |
| `autoWinClose` | `/AUTOWINCLOSE=` | 切断時に自動で閉じる |
| `disableLocalEcho` | `/E` | ローカルエコー無効 |
| `newConnectionDialog` | `/ES` `/DS` | 新しい接続ダイアログ 表示/非表示 |

接続側 (`connect`) は `binary`(`/B`)・`waitcom`(`/WAITCOM`)・`timeout`(`/TIMEOUT=`)・`proto: "namedpipe"`(`/PIPE`) にも対応します。スキーマ未対応のオプションは `connect.options` に生で書けます。

```jsonc
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro",
  "program": "${file}",
  "connect": { "proto": "ssh", "host": "192.168.0.100", "port": 22, "timeout": 15 },
  "windowTitle": "Deploy", "logFile": "${workspaceFolder}/session.log", "hidden": false
}
```

## 対応構文

| 構文 | 例 |
|------|----|
| 行コメント | `; コメント` |
| ブロックコメント | `/* ... */` |
| 文字列 | `'hello'` |
| ラベル定義 | `:loop_start` |
| 制御フロー | `if`, `for`, `while`, `do`, `goto`, `call`, `return` |
| システム変数 | `result`, `inputstr`, `matchstr`, `param1`–`param9` |

## 動作要件

- **Visual Studio Code**: 1.120.0 以降
- **OS**: Windows（マクロ実行機能を使用する場合。シンタックスハイライト、コード補完、診断などの言語機能は macOS / Linux でも動作します）
- **追加ソフトウェア**: [Tera Term](https://teratermproject.github.io/) 4 または 5


## ライセンス

MIT
