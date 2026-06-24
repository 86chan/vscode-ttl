/**
 * include パス補完の Integration テスト
 *
 * @remarks
 * `vscode.executeCompletionItemProvider` を通じて TtlCompletionProvider の include パス補完を検証する。
 * 解決基準ディレクトリ（最上位の親 parent.ttl のディレクトリ）配下のフォルダ・.ttl が候補化され、
 * 自己 include（対象ドキュメント自身）は除外されることを確認する。
 *
 * fixtures/linkroot/ の構成（parent.ttl がルート）:
 *   parent.ttl                       include 'sub/children1' / 'sub/subsub/grandchild1'
 *   sub/children1.ttl, sub/children2.ttl
 *   sub/subsub/grandchild1.ttl
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

const ROOT_DIR = path.resolve(__dirname, '../../../src/test/fixtures/linkroot');
const PARENT = path.join(ROOT_DIR, 'parent.ttl');

/**
 * 指定位置の補完候補ラベル一覧を取得
 *
 * @param uri - 対象ドキュメントの URI
 * @param position - カーソル位置
 * @returns 補完候補のラベル文字列配列
 */
async function getCompletionLabels(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<string[]> {
  await vscode.workspace.openTextDocument(uri);
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    position,
  );
  return list.items.map(item =>
    typeof item.label === 'string' ? item.label : item.label.label,
  );
}

describe('include パス補完', () => {
  it("include 'の直後はルート直下のフォルダを候補化し、対象ファイル自身は除外する", async () => {
    const uri = vscode.Uri.file(PARENT);
    // parent.ttl 2行目 `include 'sub/children1'` の開き引用符直後（列9）にカーソルを置く
    const labels = await getCompletionLabels(uri, new vscode.Position(1, 9));

    // ルート(<root>)直下の sub フォルダが候補化される
    assert.ok(labels.includes('sub'), 'sub フォルダが候補に含まれること');
    // 自己 include を避けるため parent.ttl 自身は候補から除外される
    assert.ok(!labels.includes('parent.ttl'), 'parent.ttl 自身は候補から除外されること');
  });

  it("サブディレクトリ入力後はそのフォルダ配下の .ttl とフォルダを候補化する", async () => {
    const uri = vscode.Uri.file(PARENT);
    // `include 'sub/` の直後（列13）にカーソルを置く
    const labels = await getCompletionLabels(uri, new vscode.Position(1, 13));

    // <root>/sub 配下の .ttl とサブフォルダが候補化される
    assert.ok(labels.includes('children1.ttl'), 'children1.ttl が候補に含まれること');
    assert.ok(labels.includes('children2.ttl'), 'children2.ttl が候補に含まれること');
    assert.ok(labels.includes('subsub'), 'subsub フォルダが候補に含まれること');
  });
});
