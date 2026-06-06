# ビルドと開発 / Build & Development

TTL 拡張機能のビルド・テスト手順です。

This document describes how to build and test the TTL extension.

## 開発 / Development

```sh
npm install
npm run compile

# ユニットテスト (VS Code 不要) / Unit tests (no VS Code required)
npm test

# 統合テスト (GUI / CI with xvfb が必要) / Integration tests (requires GUI or xvfb)
npm run test:integration
```
