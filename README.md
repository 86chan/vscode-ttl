# TTL - Tera Term Language Support for VS Code

[Tera Term](https://teratermproject.github.io/) のマクロ言語 TTL (Tera Term Language) に対応した VS Code 拡張機能です。

## 機能

- **シンタックスハイライト** — キーワード・コマンド・文字列・コメント・ラベル・演算子・システム変数
- **コード補完** — 201 個の組み込みコマンドをシグネチャ付きで補完
- **ホバードキュメント** — コマンド上にカーソルを置くと日本語または英語のリファレンスを表示
- **定義ジャンプ** — `goto`/`call` のラベル参照から `:label` 定義行へジャンプ (F12)
- **コード整形** — `if`/`for`/`while`/`do` などのブロック構造に応じて自動インデント。コメント内に書かれた Markdown テーブルも全角文字を考慮して桁揃え (Shift+Alt+F)
- **診断（エラー/警告）** — 無効な演算子（`&&`/`++`/`+=` など）、システム変数（`result` など）への代入、条件式での単独 `=`（比較は `==` を推奨）、ブロックの閉じ忘れ（`endif`/`next` など）、深すぎるネスト（既定 2 段）を検出

---

[Tera Term](https://teratermproject.github.io/) macro language (TTL) support extension for Visual Studio Code.

- **Syntax Highlighting** — keywords, commands, strings, comments, labels, operators, system variables
- **Code Completion** — 201 built-in commands with signatures and documentation
- **Hover Documentation** — inline reference in Japanese or English
- **Go to Definition** — jump from `goto`/`call` to `:label` definitions (F12)
- **Code Formatting** — auto-indent based on block structures such as `if`/`for`/`while`/`do`, plus alignment of Markdown tables written inside comments (full-width aware) (Shift+Alt+F)
- **Diagnostics (Errors/Warnings)** — detects invalid operators (`&&`, `++`, `+=`, etc.), assignments to system variables (e.g. `result`), a single `=` used for comparison (suggests `==`), unclosed blocks (missing `endif`/`next`, etc.), and excessive nesting (default depth 2, configurable via `ttl.maxNestingDepth`)

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
