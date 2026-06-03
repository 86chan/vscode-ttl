/**
 * include パスリネーム追従の Integration テスト
 *
 * @remarks
 * `buildIncludeRenameEdit` は `vscode.workspace.findFiles` / `openTextDocument` を
 * 使用するため VS Code プロセス内でのみ実行可能。
 *
 * fixtures/include_main.ttl が include_helper.ttl を include している構成でテストする。
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
// out/test/suite/ から out/extension へ
import { buildIncludeRenameEdit } from '../../extension';

const FIXTURES_DIR = path.resolve(__dirname, '../../../src/test/fixtures');
const MAIN_TTL = path.join(FIXTURES_DIR, 'include_main.ttl');
const HELPER_OLD = path.join(FIXTURES_DIR, 'include_helper.ttl');
const HELPER_NEW = path.join(FIXTURES_DIR, 'include_helper_renamed.ttl');

// ── include リネーム追従 ──────────────────────────────────────────────────────

describe('include リネーム追従', () => {
  it('.ttl 以外のリネームは空の WorkspaceEdit を返す', async () => {
    // When: .txt ファイルをリネームする
    const edit = await buildIncludeRenameEdit([
      {
        oldUri: vscode.Uri.file(path.join(FIXTURES_DIR, 'some.txt')),
        newUri: vscode.Uri.file(path.join(FIXTURES_DIR, 'renamed.txt')),
      },
    ]);

    // Then: 変更なし
    assert.strictEqual(edit.entries().length, 0);
  });

  it('include_helper.ttl のリネームで include_main.ttl のパスが更新される', async () => {
    // When: include_helper.ttl → include_helper_renamed.ttl
    const edit = await buildIncludeRenameEdit([
      {
        oldUri: vscode.Uri.file(HELPER_OLD),
        newUri: vscode.Uri.file(HELPER_NEW),
      },
    ]);

    // Then: include_main.ttl に対する編集が含まれる
    const entries = edit.entries();
    const mainEntry = entries.find(([uri]) => uri.fsPath === MAIN_TTL);
    assert.ok(mainEntry !== undefined, 'include_main.ttl が WorkspaceEdit に含まれること');

    const [, edits] = mainEntry;
    assert.ok(edits.length > 0, '少なくとも1件の TextEdit があること');
    assert.strictEqual(
      edits[0].newText,
      'include_helper_renamed.ttl',
      '置換後のパスが新ファイル名であること',
    );
  });

  it('無関係なファイルのリネームは include_main.ttl を変更しない', async () => {
    // When: include_main.ttl が include していないファイルをリネーム
    const edit = await buildIncludeRenameEdit([
      {
        oldUri: vscode.Uri.file(path.join(FIXTURES_DIR, 'unrelated.ttl')),
        newUri: vscode.Uri.file(path.join(FIXTURES_DIR, 'unrelated_renamed.ttl')),
      },
    ]);

    // Then: include_main.ttl は変更されない
    const entries = edit.entries();
    const mainEntry = entries.find(([uri]) => uri.fsPath === MAIN_TTL);
    assert.strictEqual(mainEntry, undefined, 'include_main.ttl は変更されないこと');
  });

  it('renames が空配列のとき空の WorkspaceEdit を返す', async () => {
    const edit = await buildIncludeRenameEdit([]);
    assert.strictEqual(edit.entries().length, 0);
  });
});
