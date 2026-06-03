/**
 * TTL拡張機能 Integration テスト
 *
 * @remarks
 * VS Code プロセス内で実行されるため、vscode API を直接呼び出せる。
 *
 * Given-When-Then 形式で記述し、各テストは独立して実行可能にする。
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

// fixtures は src/test/fixtures/ に存在する（tsc のコンパイル対象外）
// __dirname は out/test/suite/ になるため、3段上がってプロジェクトルートへ
const FIXTURE_PATH = path.resolve(__dirname, '../../../src/test/fixtures/sample.ttl');
const LANGUAGE_ID = 'ttl';

/** .ttl ファイルを開いてエディタを返す */
async function openFixture(): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.file(FIXTURE_PATH);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return document;
}

/**
 * 補完候補を取得するヘルパー
 *
 * @param uri - 対象ドキュメントのURI
 * @param position - カーソル位置
 * @returns CompletionList
 */
async function getCompletions(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.CompletionList> {
  const result = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    position,
  );
  assert.ok(result !== undefined, 'CompletionList must not be undefined');
  return result;
}

/**
 * ホバー情報を取得するヘルパー
 *
 * @param uri - 対象ドキュメントのURI
 * @param position - カーソル位置
 * @returns Hover[]
 */
async function getHovers(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.Hover[]> {
  const result = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    position,
  );
  return result ?? [];
}

/**
 * 定義位置を取得するヘルパー
 *
 * @param uri - 対象ドキュメントのURI
 * @param position - カーソル位置
 * @returns Location[]
 */
async function getDefinitions(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.Location[]> {
  const result = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeDefinitionProvider',
    uri,
    position,
  );
  return result ?? [];
}

// ── 拡張機能のアクティベーション ─────────────────────────────────────────────

describe('拡張機能のアクティベーション', () => {
  it('拡張機能が登録されている', () => {
    // Arrange: ttl-language 拡張機能を参照する
    // When: extensions から検索する
    const extension = vscode.extensions.getExtension('ttl-lsp.ttl-language');

    // Then: 拡張機能が見つかること（開発モードでは extensionDevelopmentPath から読まれる）
    assert.ok(extension !== undefined, 'ttl-language extension should be registered');
  });

  it('.ttl ファイルを開くと TTL 言語として認識される', async () => {
    // Arrange: フィクスチャを開く
    const document = await openFixture();

    // Then: 言語IDが "ttl" であること
    assert.strictEqual(document.languageId, LANGUAGE_ID);
  });
});

// ── 補完プロバイダ ────────────────────────────────────────────────────────────

describe('補完プロバイダ', () => {
  let document: vscode.TextDocument;

  before(async () => {
    document = await openFixture();
    // 拡張機能がアクティベートされるまで少し待つ
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it('TTLコマンドの補完候補が返る', async () => {
    // Arrange: ファイル先頭の空行的な位置でトリガー
    // When: 補完を要求する
    const completions = await getCompletions(document.uri, new vscode.Position(0, 0));

    // Then: 代表的なコマンドが含まれること
    const labels = completions.items.map(item =>
      typeof item.label === 'string' ? item.label : item.label.label,
    );
    assert.ok(labels.includes('sendln'), '"sendln" must appear in completions');
    assert.ok(labels.includes('connect'), '"connect" must appear in completions');
    assert.ok(labels.includes('wait'), '"wait" must appear in completions');
    assert.ok(labels.includes('messagebox'), '"messagebox" must appear in completions');
  });

  it('システム変数の補完候補が返る', async () => {
    // When: 補完を要求する
    const completions = await getCompletions(document.uri, new vscode.Position(0, 0));

    // Then: 主要なシステム変数が含まれること
    const labels = completions.items.map(item =>
      typeof item.label === 'string' ? item.label : item.label.label,
    );
    assert.ok(labels.includes('result'), '"result" must appear in completions');
    assert.ok(labels.includes('inputstr'), '"inputstr" must appear in completions');
    assert.ok(labels.includes('matchstr'), '"matchstr" must appear in completions');
  });

  it('補完候補の件数が100件以上', async () => {
    // When: 補完を要求する
    const completions = await getCompletions(document.uri, new vscode.Position(0, 0));

    // Then: 補完候補が十分な数あること
    assert.ok(completions.items.length >= 100,
      `Expected >= 100 items, got ${completions.items.length}`);
  });

  it('sendln の insertText がスニペット形式', async () => {
    // When: 補完を要求する
    const completions = await getCompletions(document.uri, new vscode.Position(0, 0));

    // Then: sendln にスニペットが設定されていること
    const sendln = completions.items.find(item => {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      return label === 'sendln';
    });
    assert.ok(sendln !== undefined, '"sendln" item must exist');
    assert.ok(
      sendln.insertText instanceof vscode.SnippetString,
      'sendln insertText must be a SnippetString',
    );
  });

  it('connect の documentation が存在する', async () => {
    // When: 補完を要求する
    const completions = await getCompletions(document.uri, new vscode.Position(0, 0));

    // Then: connect に documentation が設定されていること
    const connect = completions.items.find(item => {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      return label === 'connect';
    });
    assert.ok(connect !== undefined, '"connect" item must exist');
    assert.ok(connect.documentation !== undefined, 'connect must have documentation');
  });
});

// ── ホバープロバイダ ──────────────────────────────────────────────────────────

describe('ホバープロバイダ', () => {
  let document: vscode.TextDocument;

  before(async () => {
    document = await openFixture();
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it('connect コマンド上でホバー情報が返る', async () => {
    // Arrange: fixture の2行目（0-origin: 1）は "connect 'myserver /ssh /user=admin'"
    // When: connect の文字上（列 2）でホバーを要求する
    const hovers = await getHovers(document.uri, new vscode.Position(1, 2));

    // Then: ホバー情報が返ること
    assert.ok(hovers.length > 0, 'Hover must return at least one item for "connect"');
  });

  it('ホバー内容にシグネチャが含まれる', async () => {
    // Arrange: "sendln" は5行目（0-origin: 4）に存在
    const sendlnLine = 4; // "sendln 'whoami'"
    const hovers = await getHovers(document.uri, new vscode.Position(sendlnLine, 2));

    // Then: ホバーのコンテンツに "sendln" の文字が含まれること
    if (hovers.length > 0) {
      const content = hovers
        .flatMap(h => h.contents)
        .map(c => (c instanceof vscode.MarkdownString ? c.value : String(c)))
        .join('\n');
      assert.ok(content.includes('sendln'), 'Hover content must contain "sendln"');
    }
  });

  it('コメント行上ではホバー情報が返らない', async () => {
    // Arrange: 1行目は "; Integration test fixture"（コメント）
    // コメント中の "; " の位置
    const hovers = await getHovers(document.uri, new vscode.Position(0, 5));

    // Then: コメント内の単語はコマンドではないので、TTL固有のホバーは返らない
    // （VS Codeが他のプロバイダからホバーを返す可能性があるため、
    //   "connect" シグネチャを含まないことを確認する）
    const content = hovers
      .flatMap(h => h.contents)
      .map(c => (c instanceof vscode.MarkdownString ? c.value : String(c)))
      .join('\n');
    assert.ok(
      !content.includes('connect <command line parameters>'),
      'Comment line should not show TTL command hover',
    );
  });
});

// ── 定義ジャンプ（Go to Definition）────────────────────────────────────────────

describe('Go to Definition（ラベルジャンプ）', () => {
  let document: vscode.TextDocument;

  before(async () => {
    document = await openFixture();
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it('call do_login のラベル名にジャンプできる', async () => {
    // Arrange: fixture の "call do_login" 行を特定する
    // "call do_login" は fixture 内の行
    let callLine = -1;
    for (let i = 0; i < document.lineCount; i++) {
      if (/^\s*call\s+do_login/i.test(document.lineAt(i).text)) {
        callLine = i;
        break;
      }
    }
    assert.ok(callLine >= 0, '"call do_login" line must exist in fixture');

    // "do_login" の最初の文字の列を特定
    const lineText = document.lineAt(callLine).text;
    const labelStart = lineText.toLowerCase().indexOf('do_login');
    assert.ok(labelStart >= 0, '"do_login" must be found in the call line');

    // When: do_login の文字上で定義ジャンプを要求する
    const definitions = await getDefinitions(
      document.uri,
      new vscode.Position(callLine, labelStart + 2),
    );

    // Then: 定義位置が返ること
    assert.ok(definitions.length > 0, 'Go to definition must return at least one location');
    assert.strictEqual(
      definitions[0].uri.fsPath,
      document.uri.fsPath,
      'Definition must be in the same file',
    );
  });

  it('ジャンプ先が :do_login ラベル行', async () => {
    // Arrange: ":do_login" ラベルの行番号を特定する
    let labelLine = -1;
    for (let i = 0; i < document.lineCount; i++) {
      if (/^\s*:do_login\b/i.test(document.lineAt(i).text)) {
        labelLine = i;
        break;
      }
    }
    assert.ok(labelLine >= 0, '":do_login" label line must exist in fixture');

    // call 行を探す
    let callLine = -1;
    for (let i = 0; i < document.lineCount; i++) {
      if (/^\s*call\s+do_login/i.test(document.lineAt(i).text)) {
        callLine = i;
        break;
      }
    }

    const lineText = document.lineAt(callLine).text;
    const labelStart = lineText.toLowerCase().indexOf('do_login');

    // When: 定義ジャンプを要求する
    const definitions = await getDefinitions(
      document.uri,
      new vscode.Position(callLine, labelStart + 2),
    );

    // Then: ジャンプ先がラベル定義行
    if (definitions.length > 0) {
      assert.strictEqual(
        definitions[0].range.start.line,
        labelLine,
        `Definition must point to line ${labelLine} (:do_login), got ${definitions[0].range.start.line}`,
      );
    }
  });

  it('通常の単語では定義ジャンプが返らない', async () => {
    // Arrange: コメント行のランダムな単語
    // When: コメント内の単語（"Integration"）で定義ジャンプを要求する
    const definitions = await getDefinitions(
      document.uri,
      new vscode.Position(0, 6), // "; Integration test fixture" の "I" あたり
    );

    // Then: TTLラベルとして定義が返らないこと
    // （他のプロバイダが定義を返す場合があるが、同一ファイルのラベルは返らない）
    const sameFileDefinitions = definitions.filter(
      d => d.uri.fsPath === document.uri.fsPath,
    );
    assert.strictEqual(
      sameFileDefinitions.length,
      0,
      'Comment word should not resolve to a TTL label definition',
    );
  });
});
