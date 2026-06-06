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
- **マクロ実行** — 現在の `.ttl` を実行（エディタ右上の ▶ ボタン、またはコマンド「Run TTL Macro」）。既定は `ttermpro.exe /M=` で起動するため、`connect` 前でも `clearscreen` などの端末コマンドが使える。`ttl.runMacroVia` で `ttpmacro.exe` 直接起動にも切替可。Tera Term のインストール先は `ttl.teraTermDir`（実行ファイルがあるディレクトリ）で指定（空なら一般的なインストール先を自動探索）
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
- **Run Macro** — run the current `.ttl` (▶ button in the editor title, or the "Run TTL Macro" command). By default it launches via `ttermpro.exe /M=`, so terminal commands like `clearscreen` work even before the macro calls `connect`; switch to launching `ttpmacro.exe` directly with `ttl.runMacroVia`. Set the install directory (where the executables live) via `ttl.teraTermDir` (auto-detects common install locations when empty)
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

Tera Term の実行ファイルがあるディレクトリ（空なら自動探索）。

Directory containing Tera Term's executables (auto-detected when empty):

```json
"ttl.teraTermDir": "C:\\Program Files\\teraterm5"
```

起動方式（既定 `teraterm` = `ttermpro.exe /M=`）。

Launch mode (default `teraterm` = `ttermpro.exe /M=`):

```json
"ttl.runMacroVia": "teraterm"  // "teraterm" | "ttpmacro"
```

実行時に「新しい接続」ダイアログを表示（`teraterm` 方式で `ttermpro.exe /ES` を付与）。

Show the "New connection" dialog when running (adds `/ES`, `teraterm` mode only):

```json
"ttl.showNewConnectionDialog": true
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
