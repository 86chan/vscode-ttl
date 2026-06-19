/**
 * 定義ジャンプ（同一ファイル・クロスファイル）の Integration テスト
 *
 * @remarks
 * `vscode.executeDefinitionProvider` を通じて TtlDefinitionProvider の動作を検証する。
 * def_main.ttl が def_helper.ttl を include し、両ファイルにラベルがある構成。
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

const FIXTURES_DIR = path.resolve(__dirname, '../../../src/test/fixtures');
const MAIN_TTL = path.join(FIXTURES_DIR, 'def_main.ttl');
const HELPER_TTL = path.join(FIXTURES_DIR, 'def_helper.ttl');

/**
 * 指定位置の定義ジャンプ先を取得
 *
 * @param uri - 対象ドキュメントの URI
 * @param position - カーソル位置
 * @returns 定義の Location 配列
 */
async function getDefinitions(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.Location[]> {
  return vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeDefinitionProvider',
    uri,
    position,
  );
}

describe('定義ジャンプ', () => {
  it('同一ファイル内のラベル定義へジャンプする', async () => {
    const uri = vscode.Uri.file(MAIN_TTL);
    await vscode.workspace.openTextDocument(uri);

    // 3行目（0始まり2行目）の "call local_proc" の local_proc 上
    const position = new vscode.Position(2, 'call '.length + 2);
    const definitions = await getDefinitions(uri, position);

    assert.ok(definitions.length > 0, '定義が見つかること');
    assert.strictEqual(definitions[0].uri.fsPath, MAIN_TTL, '同一ファイルを指すこと');
  });

  it('include 先のラベル定義へジャンプする', async () => {
    const uri = vscode.Uri.file(MAIN_TTL);
    await vscode.workspace.openTextDocument(uri);

    // 4行目（0始まり3行目）の "call remote_proc" の remote_proc 上
    const position = new vscode.Position(3, 'call '.length + 2);
    const definitions = await getDefinitions(uri, position);

    assert.ok(definitions.length > 0, 'include 先の定義が見つかること');
    assert.strictEqual(definitions[0].uri.fsPath, HELPER_TTL, 'helper ファイルを指すこと');
  });

  it('未定義ラベルでは定義が見つからない', async () => {
    const uri = vscode.Uri.file(MAIN_TTL);
    await vscode.workspace.openTextDocument(uri);

    // "end" 上（ラベル参照ではない）
    const position = new vscode.Position(4, 1);
    const definitions = await getDefinitions(uri, position);

    assert.strictEqual(definitions.length, 0, '定義が返らないこと');
  });
});

describe('定義ジャンプ - 同一ファイル限定（requireLabelInSameFile）', () => {
  // 各テストの前後で設定を復元する
  let original: boolean | undefined;

  beforeEach(async () => {
    const config = vscode.workspace.getConfiguration('ttl');
    original = config.get<boolean>('requireLabelInSameFile');
    await config.update('requireLabelInSameFile', true, vscode.ConfigurationTarget.Global);
  });

  afterEach(async () => {
    await vscode.workspace
      .getConfiguration('ttl')
      .update('requireLabelInSameFile', original, vscode.ConfigurationTarget.Global);
  });

  it('同一ファイル内の定義へは従来どおりジャンプできる', async () => {
    const uri = vscode.Uri.file(MAIN_TTL);
    await vscode.workspace.openTextDocument(uri);

    const position = new vscode.Position(2, 'call '.length + 2);
    const definitions = await getDefinitions(uri, position);

    assert.ok(definitions.length > 0, '同一ファイルの定義は見つかること');
    assert.strictEqual(definitions[0].uri.fsPath, MAIN_TTL, '同一ファイルを指すこと');
  });

  it('include 先にしか定義の無いラベルへはジャンプしない', async () => {
    const uri = vscode.Uri.file(MAIN_TTL);
    await vscode.workspace.openTextDocument(uri);

    // 4行目 "call remote_proc"（remote_proc は def_helper.ttl にのみ定義）
    const position = new vscode.Position(3, 'call '.length + 2);
    const definitions = await getDefinitions(uri, position);

    assert.strictEqual(definitions.length, 0, 'include 先は探索されず定義が返らないこと');
  });
});
