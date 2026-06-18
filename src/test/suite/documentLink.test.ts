/**
 * include ジャンプ（ドキュメントリンク）の Integration テスト
 *
 * @remarks
 * `vscode.executeLinkProvider` を通じて TtlDocumentLinkProvider の動作を検証する。
 * Tera Term の include は最上位の親マクロのディレクトリを基準に解決されるため、
 * 子マクロ内の include も親(parent.ttl)のディレクトリを基準にリンク先が決まることを確認する。
 *
 * fixtures/linkroot/ の構成（parent.ttl がルート）:
 *   parent.ttl                       include 'sub/children1' / 'sub/subsub/grandchild1'
 *   sub/children1.ttl                include 'sub/children2'(正) / 'children2'(誤=リンク切れ)
 *   sub/children2.ttl
 *   sub/subsub/grandchild1.ttl       include 'sub/subsub/grandchild1.ttl'
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

const ROOT_DIR = path.resolve(__dirname, '../../../src/test/fixtures/linkroot');
const CHILDREN1 = path.join(ROOT_DIR, 'sub', 'children1.ttl');
const GRANDCHILD1 = path.join(ROOT_DIR, 'sub', 'subsub', 'grandchild1.ttl');

/**
 * 指定ドキュメントのドキュメントリンクを取得
 *
 * @param uri - 対象ドキュメントの URI
 * @returns DocumentLink 配列
 */
async function getLinks(uri: vscode.Uri): Promise<vscode.DocumentLink[]> {
  await vscode.workspace.openTextDocument(uri);
  return vscode.commands.executeCommand<vscode.DocumentLink[]>(
    'vscode.executeLinkProvider',
    uri,
  );
}

describe('include ジャンプ（ドキュメントリンク）', () => {
  it('子マクロの include は最上位の親(parent)のディレクトリ基準で解決される', async () => {
    const uri = vscode.Uri.file(CHILDREN1);
    const links = await getLinks(uri);

    // children1.ttl: 1行目 'sub/children2'（正）, 2行目 'children2'（誤）
    const correct = links.find(l => l.range.start.line === 1);
    const broken = links.find(l => l.range.start.line === 2);

    assert.ok(correct?.target !== undefined, "'sub/children2' のリンクが存在すること");
    assert.ok(broken?.target !== undefined, "'children2' のリンクが存在すること");

    // 'sub/children2' は <root>/sub/children2.ttl（実体）を指す
    assert.strictEqual(
      correct?.target?.fsPath,
      path.join(ROOT_DIR, 'sub', 'children2.ttl'),
      "'sub/children2' は親基準で <root>/sub/children2.ttl を指すこと",
    );

    // 'children2' は親基準で <root>/children2.ttl を指す（own-dir 基準の <root>/sub/children2.ttl ではない）
    assert.strictEqual(
      broken?.target?.fsPath,
      path.join(ROOT_DIR, 'children2.ttl'),
      "'children2' は親基準で <root>/children2.ttl を指すこと（リンク切れ相当）",
    );
  });

  it('孫マクロの include も最上位の親(parent)のディレクトリ基準で解決される', async () => {
    const uri = vscode.Uri.file(GRANDCHILD1);
    const links = await getLinks(uri);

    const link = links.find(l => l.range.start.line === 1);
    assert.ok(link?.target !== undefined, 'include リンクが存在すること');
    assert.strictEqual(
      link?.target?.fsPath,
      path.join(ROOT_DIR, 'sub', 'subsub', 'grandchild1.ttl'),
      "'sub/subsub/grandchild1.ttl' は親基準で <root>/sub/subsub/grandchild1.ttl を指すこと",
    );
  });
});
