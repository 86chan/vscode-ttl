/**
 * ラベルリネームヘルパー関数のユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数のみを対象とする。
 * プロバイダ全体の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import { extractLabelDefinition, extractLabelReferences } from '../labelUtils';

// ── extractLabelDefinition ────────────────────────────────────────────────────

describe('extractLabelDefinition', () => {
  it('行頭のラベル定義を検出する', () => {
    const result = extractLabelDefinition(':do_login');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('do_login');
  });

  it('インデント付きラベル定義を検出する', () => {
    const result = extractLabelDefinition('  :loop_start');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('loop_start');
  });

  it('nameStart がコロンの次の文字位置を指す', () => {
    const line = ':do_login';
    const result = extractLabelDefinition(line);
    expect(result?.nameStart).toBe(1);
    expect(line.slice(result!.nameStart, result!.nameStart + result!.name.length)).toBe('do_login');
  });

  it('インデント付きの nameStart が正しい', () => {
    const line = '  :loop_start';
    const result = extractLabelDefinition(line);
    expect(result?.nameStart).toBe(3);
  });

  it('ラベル定義でない行は null を返す', () => {
    expect(extractLabelDefinition('goto do_login')).toBeNull();
    expect(extractLabelDefinition('call do_login')).toBeNull();
    expect(extractLabelDefinition('; :not_a_label')).toBeNull();
    expect(extractLabelDefinition('')).toBeNull();
    expect(extractLabelDefinition('sendln hello')).toBeNull();
  });

  it('ラベル名が小文字で返る', () => {
    const result = extractLabelDefinition(':DoLogin');
    expect(result?.name).toBe('dologin');
  });
});

// ── extractLabelReferences ────────────────────────────────────────────────────

describe('extractLabelReferences', () => {
  it('goto 参照を検出する', () => {
    const results = extractLabelReferences('goto loop_start');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('loop_start');
  });

  it('call 参照を検出する', () => {
    const results = extractLabelReferences('call do_login');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('do_login');
  });

  it('大文字小文字を問わずマッチする', () => {
    expect(extractLabelReferences('GOTO target')).toHaveLength(1);
    expect(extractLabelReferences('CALL target')).toHaveLength(1);
  });

  it('ラベル参照でない行は空配列を返す', () => {
    expect(extractLabelReferences(':do_login')).toHaveLength(0);
    expect(extractLabelReferences('; call do_login')).toHaveLength(0);
    expect(extractLabelReferences('sendln hello')).toHaveLength(0);
    expect(extractLabelReferences('')).toHaveLength(0);
  });

  it('nameStart がラベル名の開始列を指す', () => {
    const line = 'call do_login';
    const results = extractLabelReferences(line);
    expect(results[0].nameStart).toBe(line.indexOf('do_login'));
    expect(line.slice(results[0].nameStart, results[0].nameStart + results[0].name.length)).toBe('do_login');
  });

  it('ラベル名が小文字で返る', () => {
    const results = extractLabelReferences('goto DoLogin');
    expect(results[0].name).toBe('dologin');
  });
});
