# 将来対応: エントリポイント方式のクロスファイル参照追跡と永続索引

> ステータス: **未着手（計画のみ）**。本ドキュメントは設計メモ。実装は保留。

## 背景・目的

既存診断では、include されるヘルパー単体で見ると「親から呼ばれるラベル」が未使用/未定義に
見える誤検知のため、**未使用ラベル**と**正確な未定義ラベル**判定を見送っている。
これを解くにはファイルをまたいだ参照追跡が必要。

「ワークスペース全体を毎キーストロークで走査」は重い。そこで **エントリポイント方式** を採る:

- ユーザーがエクスプローラ右クリックで **起点 .ttl を1つ指定**。
- 起点から `include` を親→子→孫…と辿った **到達閉包（=1マクロプログラム）** を対象に
  ラベルの定義・参照を集計する。
- 閉包内のどこかで参照されていれば「使用中」、どこにも無ければ「未使用」。
  定義が閉包内にあれば「定義済み」。

閉包は小さいため、読むのはプログラムのファイルだけ。全走査より軽く、TTL の実態に合って正確。

## 確定済みの設計判断

- 判定範囲 = **起点の include 到達閉包**（ワークスペース全体ではない）。
- 未使用ラベル `ttl.diagnostics.unusedLabel` は **既定 OFF**。
  「設定 ON かつ 起点設定済み かつ 対象が閉包内」のときのみ実行（区切りラベル等の誤検知を回避）。
- **永続化は将来段階**。入れる場合は **stat(mtime+size) 優先 ＋ ハッシュ補助**、
  保存先 `context.storageUri`、形式 **JSON**（SQLite はネイティブ依存/バンドル問題を避けるため不採用）。
- 索引の `FileSummary` と API は、後で **変数の定義/参照** を足せる形にしておく。

## 実装ステップ（着手時の手順）

### 1. 純粋関数: ファイルサマリ抽出（`src/navigationUtils.ts`）
- `extractFileSummary(text): FileSummary`、
  `FileSummary = { labelDefs: Set<string>; labelRefs: Set<string>; includePaths: string[] }`。
- 既存 `extractDocumentSymbols` / `extractLabelReferences`(`labelUtils`) / `extractIncludeDirectives` を再利用。
- 将来 `varDefs` / `varRefs` を追加できる型にしておく。

### 2. 診断ロジック: 未使用ラベル（`src/diagnosticsUtils.ts`）
- `AnalyzeOptions` に `referencedLabels?: ReadonlySet<string>` と `checkUnusedLabel?: boolean`（既定 false）。
- `findUnusedLabels(maskedLines, referencedLabels)`: ローカル参照と合算し、定義名がどこにも無ければ
  `code: 'unused-label'`（VS Code 層で Hint + `DiagnosticTag.Unnecessary` の淡色表示に変換）。
- 既存 `externalLabels` に閉包の全定義を渡すことで undefined-label の誤検知も解消。

### 3. 索引（新規 `src/workspaceIndex.ts`・インメモリ）
- `TtlWorkspaceIndex`: `summaries: Map<fsPath, FileSummary>` の遅延キャッシュ。`dispose` 可。
- `computeProgram(entryUri): { files; labelDefs; labelRefs; complete }` — 起点から include を BFS
  （`resolveIncludeUris` 相当、`visited` で循環防止）。開けない include があれば `complete=false`。
- **将来の差し替え点**: サマリ取得を `loadSummary(uri)` 1メソッドに集約し、
  「キャッシュ→open」から「永続DB→stat 差分→open」へ置換できるようにする。

### 4. エントリポイント UX（`package.json` / `src/extension.ts`）
- `contributes.commands`: `ttl.setEntryPoint` / `ttl.clearEntryPoint`。
- `contributes.menus.explorer/context`: `when: resourceExtname == .ttl`。
- 設定 `ttl.entryPoint`（string, 既定 ""）、`ttl.diagnostics.unusedLabel`（boolean, 既定 false）。
- ステータスバーに現在の起点ファイル名を表示（クリックで再設定）。

### 5. 診断統合（`src/extension.ts` `refreshDiagnostics`）
- 起点設定済みなら `index.computeProgram(entryUri)` で閉包取得。
- 対象が閉包内: `externalLabels = labelDefs`、`checkUndefinedLabels = complete`、
  `referencedLabels = labelRefs`、`checkUnusedLabel = (設定 && complete)`。
- 閉包外/起点未設定: 既存挙動（`collectIncludedLabels` ベース、unused 無効）。
- `FileSystemWatcher('**/*.ttl')` を追加し、変更時に `index.invalidate` → 開いている全 .ttl を再診断。

## さらに将来（同じ索引基盤の上に）

- **永続索引**: `context.storageUri` に JSON（スキーマ版番号付き）で `path → { mtimeMs, size, hash?, summary }`。
  起動時 `findFiles` + 各 `fs.stat` で mtime+size 比較し、未変更は read/parse をスキップ。
  変更時のみ read、必要なら content hash を二次確認。`loadSummary` 差し替えで載る。
- **変数の定義/参照・定義ジャンプ**: `FileSummary` に `varDefs`(代入) / `varRefs`(使用) を追加し閉包で集計。
  TTL 変数はグローバルスコープのため「定義=最初の代入、参照=全使用」で、既存のラベル用
  `ReferenceProvider` / `DefinitionProvider` と同型で変数へ拡張可能。
- **ワークスペースシンボル**（Ctrl+T）: 索引のラベル/変数定義をそのまま供給。

## 検証方針
- ユニット（vitest）: `extractFileSummary` / `findUnusedLabels` / unused-label 既定 OFF。
- 統合（@vscode/test-electron）: `def_main.ttl` + `def_helper.ttl`、起点=`def_main` で
  未使用・未定義の検出と、helper 編集時も起点プログラム文脈で判定されること。
- 既存テストが緑のまま（`externalLabels` 経路不変、unused 既定 OFF）。
