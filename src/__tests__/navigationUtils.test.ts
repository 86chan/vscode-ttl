/**
 * ナビゲーション解析ユーティリティのユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数のみを対象とする。
 * プロバイダ全体の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import {
  collectLabelOccurrences,
  extractDocumentSymbols,
  extractIncludeDirectives,
} from '../navigationUtils';

describe('extractIncludeDirectives', () => {
  it('include 文を行番号付きで抽出する', () => {
    const text = "sendln 'hi'\ninclude 'lib/helper.ttl'\n";
    const result = extractIncludeDirectives(text);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('lib/helper.ttl');
    expect(result[0].line).toBe(1);
  });

  it('パス範囲が引用符の内側を指す', () => {
    const line = "include 'sub/file.ttl'";
    const result = extractIncludeDirectives(line);
    expect(line.slice(result[0].startCharacter, result[0].endCharacter)).toBe('sub/file.ttl');
  });

  it('行コメント内の include は無視する', () => {
    expect(extractIncludeDirectives("; include 'x.ttl'")).toHaveLength(0);
    expect(extractIncludeDirectives("sendln 'a' ; include 'x.ttl'")).toHaveLength(0);
  });

  it('CRLF 改行を扱える', () => {
    const result = extractIncludeDirectives("include 'a.ttl'\r\ninclude 'b.ttl'\r\n");
    expect(result.map(r => r.path)).toEqual(['a.ttl', 'b.ttl']);
    expect(result[1].line).toBe(1);
  });

  it('include がなければ空配列を返す', () => {
    expect(extractIncludeDirectives("sendln 'hello'")).toHaveLength(0);
  });
});

describe('extractDocumentSymbols', () => {
  it('ラベル定義と include をシンボルとして抽出する', () => {
    const text = "include 'lib.ttl'\n:do_login\nsendln 'x'\n:loop\n";
    const symbols = extractDocumentSymbols(text);
    expect(symbols.map(s => s.kind)).toEqual(['include', 'label', 'label']);
    expect(symbols.map(s => s.name)).toEqual(['lib.ttl', 'do_login', 'loop']);
  });

  it('ラベル名は元の大文字小文字を保持する', () => {
    const symbols = extractDocumentSymbols(':DoLogin');
    expect(symbols[0].name).toBe('DoLogin');
  });

  it('ラベルの範囲が先頭コロンを含む', () => {
    const line = '  :loop_start';
    const symbols = extractDocumentSymbols(line);
    expect(line.slice(symbols[0].startCharacter, symbols[0].endCharacter)).toBe(':loop_start');
  });

  it('行番号順・列順に並ぶ', () => {
    const text = ":a\ninclude 'b.ttl'\n:c";
    const symbols = extractDocumentSymbols(text);
    expect(symbols.map(s => s.line)).toEqual([0, 1, 2]);
  });

  it('シンボルがなければ空配列を返す', () => {
    expect(extractDocumentSymbols("sendln 'hello'\nwait '$'")).toHaveLength(0);
  });
});

describe('collectLabelOccurrences', () => {
  const source = [
    ':do_login',          // 0: 定義
    'sendln inputstr',    // 1
    'call do_login',      // 2: 参照
    'goto DO_LOGIN',      // 3: 参照（大文字）
    '; call do_login',    // 4: コメント内（対象外）
    'goto other',         // 5: 別ラベル
  ].join('\n');

  it('定義と参照を全て収集する', () => {
    const result = collectLabelOccurrences(source, 'do_login');
    expect(result).toHaveLength(3);
    expect(result.filter(r => r.isDefinition)).toHaveLength(1);
    expect(result.filter(r => !r.isDefinition)).toHaveLength(2);
  });

  it('大文字小文字を区別しない', () => {
    const result = collectLabelOccurrences(source, 'DO_LOGIN');
    expect(result).toHaveLength(3);
  });

  it('コメント内の参照は除外する', () => {
    const result = collectLabelOccurrences(source, 'do_login');
    expect(result.some(r => r.line === 4)).toBe(false);
  });

  it('定義の範囲がラベル名を指す', () => {
    const result = collectLabelOccurrences(':do_login', 'do_login');
    expect(':do_login'.slice(result[0].startCharacter, result[0].endCharacter)).toBe('do_login');
  });

  it('該当ラベルがなければ空配列を返す', () => {
    expect(collectLabelOccurrences(source, 'missing')).toHaveLength(0);
  });
});
