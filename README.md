# TTL - Tera Term Language Support for VS Code

[Tera Term](https://teratermproject.github.io/) のマクロ言語 TTL (Tera Term Language) に対応した VS Code 拡張機能です。

## 機能

- **シンタックスハイライト** — キーワード・コマンド・文字列・コメント・ラベル・演算子・システム変数
- **コード補完** — 201 個の組み込みコマンドをシグネチャ付きで補完
- **ホバードキュメント** — コマンド上にカーソルを置くと日本語または英語のリファレンスを表示
- **定義ジャンプ** — `goto`/`call` のラベル参照から `:label` 定義行へジャンプ。同一ファイルに無ければ `include` 先（再帰的に）も探索 (F12)
- **参照検索** — ラベルの定義・参照（`goto`/`call`）の一覧を表示 (Shift+F12)
- **アウトライン / シンボル** — ラベル定義と `include` をパンくず・アウトライン・シンボル検索（Ctrl+Shift+O）に表示
- **include リンク** — `include 'path'` のパスを Ctrl+クリックで開く
- **マクロ実行（デバッグ構成）** — `launch.json` の「構成の追加」に **TTL Macro (Tera Term)** が並び、F5 / ▶ で現在のマクロを Tera Term で実行。接続（SSH/Telnet/シリアル）を構造化した `connect` で指定（[使い方](#マクロ実行--running-macros)）
- **コード整形** — `if`/`for`/`while`/`do` などのブロック構造に応じて自動インデント。コメント内に書かれた Markdown テーブルも全角文字を考慮して桁揃え (Shift+Alt+F)
- **診断（エラー/警告）** — 無効な演算子（`&&`/`++`/`+=` など）、システム変数（`result` など）への代入、条件式での単独 `=`（比較は `==` を推奨）、ブロックの閉じ忘れ（`endif`/`next` など）、深すぎるネスト（既定 2 段）、未知のコマンド（近いコマンドを提案）、未定義ラベルへの `goto`/`call`（include 先も解決）、重複したラベル定義を検出

---

[Tera Term](https://teratermproject.github.io/) macro language (TTL) support extension for Visual Studio Code.

- **Syntax Highlighting** — keywords, commands, strings, comments, labels, operators, system variables
- **Code Completion** — 201 built-in commands with signatures and documentation
- **Hover Documentation** — inline reference in Japanese or English
- **Go to Definition** — jump from `goto`/`call` to `:label` definitions; falls back to (recursively) searching `include`d files (F12)
- **Find All References** — list a label's definition and references (`goto`/`call`) (Shift+F12)
- **Outline / Symbols** — labels and `include`s shown in breadcrumbs, outline, and symbol search (Ctrl+Shift+O)
- **Include Links** — Ctrl+click the path in `include 'path'` to open the file
- **Run Macro (debug config)** — **TTL Macro (Tera Term)** appears in launch.json's "Add Configuration", and F5 / ▶ runs the current macro with Tera Term. Describe the connection (SSH / Telnet / serial) with a structured `connect` object ([usage](#マクロ実行--running-macros))
- **Code Formatting** — auto-indent based on block structures such as `if`/`for`/`while`/`do`, plus alignment of Markdown tables written inside comments (full-width aware) (Shift+Alt+F)
- **Diagnostics (Errors/Warnings)** — detects invalid operators (`&&`, `++`, `+=`, etc.), assignments to system variables (e.g. `result`), a single `=` used for comparison (suggests `==`), unclosed blocks (missing `endif`/`next`, etc.), excessive nesting (default depth 2, configurable via `ttl.maxNestingDepth`), unknown commands (suggests the closest command), `goto`/`call` to undefined labels (includes resolved), and duplicate label definitions

## 言語設定 / Language Setting

VS Code の UI 言語を自動検出して日本語・英語を切り替えます。設定で固定することも可能です。

The extension auto-detects the VS Code UI language. Override in settings:

```json
"ttl.language": "auto"  // "auto" | "ja" | "en"
```

ネスト警告の上限段数も設定できます（既定 2、0 で無効化）。

The maximum nesting depth before a warning is also configurable (default 2, 0 disables it):

```json
"ttl.maxNestingDepth": 2
```

個別の診断は設定で無効化できます（いずれも既定 true）。

Individual diagnostics can be toggled (all default `true`):

```json
"ttl.diagnostics.undefinedLabel": true,
"ttl.diagnostics.unknownCommand": true,
"ttl.diagnostics.duplicateLabel": true
```

## マクロ実行 / Running Macros

`launch.json` のデバッグ構成として実行します。**実行とデバッグ** パネルで「launch.json ファイルを作成」→ **TTL Macro (Tera Term)** を選ぶか、`launch.json` の「構成の追加」から追加します。F5 または ▶ で起動します（Windows + Tera Term が必要）。

Run macros as a debug configuration. In the **Run and Debug** view, "create a launch.json file" → pick **TTL Macro (Tera Term)**, or use "Add Configuration" in `launch.json`. Launch with F5 or ▶ (requires Windows + Tera Term).

接続は構造化した `connect` オブジェクトで記述し、拡張が Tera Term の CLI オプションに変換します。`connect` を省略すると接続せずに起動し、接続はマクロ内の `connect` に委ねます。

Describe the connection with a structured `connect` object; the extension translates it to Tera Term CLI options. Omit `connect` to launch without connecting (the macro's own `connect` handles it).

```jsonc
// SSH
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro (SSH)",
  "program": "${file}",            // 実行するマクロ / macro to run
  "connect": {
    "proto": "ssh",                // "ssh" | "telnet" | "console"(=serial)
    "host": "192.168.0.100",
    "port": 22,
    "options": ["/auth=password", "/user=admin"]  // 追加の生オプション / extra raw options
  },
  "teraTermDir": ""                 // 空なら自動探索 / auto-detected when empty
}
// → ttermpro.exe 192.168.0.100:22 /ssh /auth=password /user=admin /M=<file>
```

```jsonc
// シリアル / Serial (console)
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro (Serial)",
  "program": "${file}",
  "connect": {
    "proto": "console",
    "comport": 3,        // COM ポート番号 / COM port (1–256)
    "speed": 115200,     // ボーレート / baud
    "cdatabit": 8,       // 7 | 8
    "cparity": "none",   // none | odd | even | mark | space
    "cstopbit": 1,       // 1 | 1.5 | 2
    "cflowctrl": "hard"  // x | hard | none | rtscts | dsrdtr
  }
}
// → ttermpro.exe /C=3 /BAUD=115200 /CDATABIT=8 /CPARITY=none /CSTOPBIT=1 /CFLOWCTRL=hard /M=<file>
```

`connect.host` に `${input:ttlHost}` を指定し、`launch.json` に `inputs` を足せば、実行時に接続先を入力できます。

Use `${input:ttlHost}` for `connect.host` (with an `inputs` entry) to prompt for the host on each run:

```jsonc
{
  "configurations": [
    { "type": "ttl", "request": "launch", "name": "Run TTL Macro (prompt host)",
      "program": "${file}", "connect": { "proto": "ssh", "host": "${input:ttlHost}", "port": 22 } }
  ],
  "inputs": [
    { "id": "ttlHost", "type": "promptString", "description": "接続先 / Host (e.g. 192.168.0.100)" }
  ]
}
```

## 対応構文 / Supported Syntax

| 構文 | 例 |
|------|----|
| 行コメント / Line comment | `; コメント` |
| ブロックコメント / Block comment | `/* ... */` |
| 文字列 / String | `'hello'` |
| ラベル定義 / Label definition | `:loop_start` |
| 制御フロー / Control flow | `if`, `for`, `while`, `do`, `goto`, `call`, `return` |
| システム変数 / System variables | `result`, `inputstr`, `matchstr`, `param1`–`param9` |

## 動作要件 / Requirements

VS Code 1.85.0 以降 / VS Code 1.85.0 or later.

## 開発 / Development

```sh
npm install
npm run compile

# ユニットテスト (VS Code 不要) / Unit tests (no VS Code required)
npm test

# 統合テスト (GUI / CI with xvfb が必要) / Integration tests (requires GUI or xvfb)
npm run test:integration
```

## ライセンス / License

MIT
