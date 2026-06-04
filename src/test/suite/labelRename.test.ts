/**
 * ラベルリネームプロバイダの Integration テスト
 *
 * @remarks
 * `TtlRenameProvider` は vscode.TextDocument を使うため VS Code プロセス内で実行する。
 * fixtures/sample.ttl の `:do_login` / `call do_login` を対象とする。
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TtlRenameProvider } from '../../extension';

const FIXTURE_PATH = path.resolve(__dirname, '../../../src/test/fixtures/sample.ttl');

/** sample.ttl を開いて TextDocument を返す */
async function openSampleFixture(): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE_PATH));
}

/**
 * document 内で pattern にマッチする最初の行番号と列を返す
 *
 * @param document - 対象ドキュメント
 * @param pattern - 検索パターン
 * @returns 行番号と列のペア
 */
function findPosition(
  document: vscode.TextDocument,
  pattern: RegExp,
): { line: number; character: number } {
  for (let i = 0; i < document.lineCount; i++) {
    const match = pattern.exec(document.lineAt(i).text);
    if (match !== null) return { line: i, character: match.index + (match[1] ? match[0].indexOf(match[1]) : 0) };
  }
  throw new Error(`Pattern ${pattern} not found in fixture`);
}

const provider = new TtlRenameProvider();

describe('TtlRenameProvider.prepareRename', () => {
  let document: vscode.TextDocument;

  before(async () => {
    document = await openSampleFixture();
  });

  it(':do_login 定義行でラベル名の Range を返す', () => {
    const { line, character } = findPosition(document, /^\s*:(do_login)/);
    const range = provider.prepareRename(document, new vscode.Position(line, character + 1));
    assert.ok(range !== undefined, 'prepareRename must return a range on label definition');
    assert.strictEqual(document.getText(range), 'do_login');
  });

  it('call do_login の参照上でラベル名の Range を返す', () => {
    const { line, character } = findPosition(document, /\bcall\s+(do_login)/);
    const range = provider.prepareRename(document, new vscode.Position(line, character + 2));
    assert.ok(range !== undefined, 'prepareRename must return a range on label reference');
    assert.strictEqual(document.getText(range), 'do_login');
  });

  it('コメント行では undefined を返す', () => {
    const range = provider.prepareRename(document, new vscode.Position(0, 5));
    assert.strictEqual(range, undefined);
  });

  it('コマンド名の位置では undefined を返す', () => {
    const { line } = findPosition(document, /\bsendln\b/);
    const range = provider.prepareRename(document, new vscode.Position(line, 2));
    assert.strictEqual(range, undefined, 'sendln is not a label');
  });
});

describe('TtlRenameProvider.provideRenameEdits', () => {
  let document: vscode.TextDocument;

  before(async () => {
    document = await openSampleFixture();
  });

  it('定義行から do_login を renamed_login に一括置換する WorkspaceEdit を返す', () => {
    const { line, character } = findPosition(document, /^\s*:(do_login)/);
    const edit = provider.provideRenameEdits(
      document,
      new vscode.Position(line, character + 1),
      'renamed_login',
    );
    assert.ok(edit !== undefined, 'WorkspaceEdit must not be undefined');

    const fileEdits = edit.get(document.uri);
    assert.ok(fileEdits.length >= 2, 'Must replace definition and at least one reference');

    const newTexts = fileEdits.map(e => e.newText);
    assert.ok(newTexts.every(t => t === 'renamed_login'), 'All replacements must use the new name');
  });

  it('参照行から do_login を renamed_login に一括置換する', () => {
    const { line, character } = findPosition(document, /\bcall\s+(do_login)/);
    const edit = provider.provideRenameEdits(
      document,
      new vscode.Position(line, character + 2),
      'renamed_login',
    );
    assert.ok(edit !== undefined);

    const fileEdits = edit.get(document.uri);
    assert.ok(fileEdits.length >= 2, 'Must replace definition and reference');
  });

  it('置換後に :do_login がなく :renamed_login がある', () => {
    const { line, character } = findPosition(document, /^\s*:(do_login)/);
    const edit = provider.provideRenameEdits(
      document,
      new vscode.Position(line, character + 1),
      'renamed_login',
    );
    assert.ok(edit !== undefined);

    const fileEdits = edit.get(document.uri);
    const replacedRanges = fileEdits.map(e => document.getText(e.range));
    assert.ok(replacedRanges.every(t => t.toLowerCase() === 'do_login'));
  });

  it('ラベルでない位置では undefined を返す', () => {
    const edit = provider.provideRenameEdits(document, new vscode.Position(0, 5), 'new_name');
    assert.strictEqual(edit, undefined);
  });
});
