/**
 * TTL コード整形ヘルパー関数のユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 formatTtl のみを対象とする。
 * プロバイダ全体の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import { formatTtl } from '../formatUtils';

describe('formatTtl', () => {
  it('if/then ブロックの本体をインデントする', () => {
    const input = ['if result <> 2 then', 'messagebox \'NG\' \'Error\'', 'endif'].join('\n');
    const expected = ['if result <> 2 then', '  messagebox \'NG\' \'Error\'', 'endif'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('for/next ブロックの本体をインデントする', () => {
    const input = ['for i 1 10', 'mpause 500', 'next'].join('\n');
    const expected = ['for i 1 10', '  mpause 500', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('while/endwhile ブロックの本体をインデントする', () => {
    const input = ['while result = 0', 'recvln', 'endwhile'].join('\n');
    const expected = ['while result = 0', '  recvln', 'endwhile'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('ネストしたブロックを多段インデントする', () => {
    const input = [
      'for i 1 10',
      'if result = 0 then',
      'break',
      'endif',
      'next',
    ].join('\n');
    const expected = [
      'for i 1 10',
      '  if result = 0 then',
      '    break',
      '  endif',
      'next',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('else / elseif で本体をインデントし分岐行自体は浅くする', () => {
    const input = [
      'if a = 1 then',
      'sendln \'one\'',
      'elseif a = 2 then',
      'sendln \'two\'',
      'else',
      'sendln \'other\'',
      'endif',
    ].join('\n');
    const expected = [
      'if a = 1 then',
      '  sendln \'one\'',
      'elseif a = 2 then',
      '  sendln \'two\'',
      'else',
      '  sendln \'other\'',
      'endif',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('then の後にコマンドが続く単一行 if はブロックを開かない', () => {
    const input = ['if result = 0 then break', 'sendln \'next\''].join('\n');
    const expected = ['if result = 0 then break', 'sendln \'next\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('ラベル定義行は常にインデント0に揃える', () => {
    const input = ['for i 1 10', '  :inner', 'next'].join('\n');
    const expected = ['for i 1 10', ':inner', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('空行は末尾空白なしの空行として保持する', () => {
    const input = ['for i 1 10', '   ', 'mpause 1', 'next'].join('\n');
    const expected = ['for i 1 10', '', '  mpause 1', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('文字列内のキーワードはネスト計算に影響しない', () => {
    const input = ['sendln \'for next endif\'', 'wait \'$\''].join('\n');
    const expected = ['sendln \'for next endif\'', 'wait \'$\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('コメント内のキーワードはネスト計算に影響しない', () => {
    const input = ['wait \'$\' ; if then endif', 'sendln \'ok\''].join('\n');
    const expected = ['wait \'$\' ; if then endif', 'sendln \'ok\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('既存の誤ったインデントを正しく再計算する', () => {
    const input = ['      for i 1 10', 'mpause 1', '          next'].join('\n');
    const expected = ['for i 1 10', '  mpause 1', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('閉じキーワードが過剰でもインデントは負にならない', () => {
    const input = ['endif', 'sendln \'ok\''].join('\n');
    const expected = ['endif', 'sendln \'ok\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('indentUnit オプションでインデント文字を切り替えられる', () => {
    const input = ['for i 1 10', 'mpause 1', 'next'].join('\n');
    const expected = ['for i 1 10', '\tmpause 1', 'next'].join('\n');
    expect(formatTtl(input, { indentUnit: '\t' })).toBe(expected);
  });

  it('CRLF 改行を保持する', () => {
    const input = ['for i 1 10', 'mpause 1', 'next'].join('\r\n');
    const expected = ['for i 1 10', '  mpause 1', 'next'].join('\r\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('do/loop ブロックの本体をインデントする', () => {
    const input = ['do', 'recvln', 'loop'].join('\n');
    const expected = ['do', '  recvln', 'loop'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });
});
