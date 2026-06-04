/**
 * TTL 静的診断ヘルパー関数のユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 analyzeTtl のみを対象とする。
 * プロバイダ全体の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import { analyzeTtl } from '../diagnosticsUtils';

describe('analyzeTtl - 無効な演算子', () => {
  it('論理積 && を検出し and を提案する', () => {
    // Arrange: C 言語風の論理積を含む条件式
    const text = 'if a = 1 && b = 2 then';
    // Act
    const diagnostics = analyzeTtl(text);
    // Assert: && が error として検出される
    const operatorDiagnostic = diagnostics.find(d => d.code === 'invalid-operator');
    expect(operatorDiagnostic).toBeDefined();
    expect(operatorDiagnostic?.severity).toBe('error');
    expect(text.slice(operatorDiagnostic!.startCharacter, operatorDiagnostic!.endCharacter)).toBe('&&');
    expect(operatorDiagnostic?.message).toContain("'and'");
  });

  it('論理和 || を検出する', () => {
    const diagnostics = analyzeTtl('if a || b then');
    expect(diagnostics.some(d => d.code === 'invalid-operator')).toBe(true);
  });

  it('複合代入 += を検出する', () => {
    const diagnostics = analyzeTtl('count += 1');
    const diagnostic = diagnostics.find(d => d.code === 'invalid-operator');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('複合代入');
  });

  it('インクリメント ++ を検出する', () => {
    const diagnostics = analyzeTtl('i++');
    expect(diagnostics.some(d => d.code === 'invalid-operator')).toBe(true);
  });

  it('=== を1件として検出する（== として二重計上しない）', () => {
    const diagnostics = analyzeTtl('if a === b then');
    const operatorDiagnostics = diagnostics.filter(d => d.code === 'invalid-operator');
    expect(operatorDiagnostics).toHaveLength(1);
    expect(operatorDiagnostics[0].endCharacter - operatorDiagnostics[0].startCharacter).toBe(3);
  });

  it('正しい演算子（=, ==, <>, >=, and）は検出しない', () => {
    const text = [
      'a = 1',
      'if b == 2 then',
      'if c <> 3 then',
      'if d >= 4 and e <= 5 then',
    ].join('\n');
    const diagnostics = analyzeTtl(text);
    expect(diagnostics.filter(d => d.code === 'invalid-operator')).toHaveLength(0);
  });

  it('文字列リテラル内の && は検出しない', () => {
    const diagnostics = analyzeTtl("sendln 'cmd1 && cmd2'");
    expect(diagnostics.filter(d => d.code === 'invalid-operator')).toHaveLength(0);
  });

  it('行コメント内の && は検出しない', () => {
    const diagnostics = analyzeTtl('wait \'$\' ; a && b');
    expect(diagnostics.filter(d => d.code === 'invalid-operator')).toHaveLength(0);
  });

  it('ブロックコメント内（複数行）の演算子は検出しない', () => {
    const text = ['/* a && b', 'c || d */', 'sendln \'ok\''].join('\n');
    const diagnostics = analyzeTtl(text);
    expect(diagnostics.filter(d => d.code === 'invalid-operator')).toHaveLength(0);
  });
});

describe('analyzeTtl - システム変数への代入', () => {
  it('result への代入を warning として検出する', () => {
    const diagnostics = analyzeTtl('result = 5');
    const diagnostic = diagnostics.find(d => d.code === 'reserved-variable-assignment');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.startCharacter).toBe(0);
    expect(diagnostic?.endCharacter).toBe(6);
  });

  it('param1 への代入を検出する', () => {
    const diagnostics = analyzeTtl('  param1 = inputstr');
    const diagnostic = diagnostics.find(d => d.code === 'reserved-variable-assignment');
    expect(diagnostic).toBeDefined();
    // インデント分だけ開始列がずれること
    expect(diagnostic?.startCharacter).toBe(2);
  });

  it('比較演算（if result = 0 then）は代入として検出しない', () => {
    const diagnostics = analyzeTtl('if result = 0 then');
    expect(diagnostics.filter(d => d.code === 'reserved-variable-assignment')).toHaveLength(0);
  });

  it('等価比較（result == 0）は代入として検出しない', () => {
    const diagnostics = analyzeTtl('result == 0');
    expect(diagnostics.filter(d => d.code === 'reserved-variable-assignment')).toHaveLength(0);
  });

  it('書き込み可能な timeout / mtimeout への代入は検出しない', () => {
    const diagnostics = analyzeTtl(['timeout = 10', 'mtimeout = 500'].join('\n'));
    expect(diagnostics.filter(d => d.code === 'reserved-variable-assignment')).toHaveLength(0);
  });

  it('通常のユーザー変数への代入は検出しない', () => {
    const diagnostics = analyzeTtl('myvar = 1');
    expect(diagnostics).toHaveLength(0);
  });

  it('大文字小文字を区別せず検出する', () => {
    const diagnostics = analyzeTtl('RESULT = 1');
    expect(diagnostics.some(d => d.code === 'reserved-variable-assignment')).toBe(true);
  });
});

describe('analyzeTtl - 比較演算子としての単独 =', () => {
  it('if 条件内の単独 = を warning として検出し == を提案する', () => {
    const diagnostics = analyzeTtl('if result = 0 then');
    const diagnostic = diagnostics.find(d => d.code === 'comparison-single-equals');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.message).toContain('==');
    // = の1文字だけを指すこと
    expect(diagnostic?.endCharacter).toBe(diagnostic!.startCharacter + 1);
  });

  it('elseif 条件内の単独 = を検出する', () => {
    const diagnostics = analyzeTtl('elseif a = 2 then');
    expect(diagnostics.some(d => d.code === 'comparison-single-equals')).toBe(true);
  });

  it('while 条件内の単独 = を検出する', () => {
    const diagnostics = analyzeTtl('while result = 0');
    expect(diagnostics.some(d => d.code === 'comparison-single-equals')).toBe(true);
  });

  it('== / <= / >= / <> / != は比較記号として正しく、検出しない', () => {
    const text = [
      'if a == 1 then',
      'if b <= 2 then',
      'if c >= 3 then',
      'if d <> 4 then',
      'while e != 5',
    ].join('\n');
    const diagnostics = analyzeTtl(text);
    expect(diagnostics.filter(d => d.code === 'comparison-single-equals')).toHaveLength(0);
  });

  it('代入文（var = value）は比較として検出しない', () => {
    const diagnostics = analyzeTtl('myvar = 1');
    expect(diagnostics.filter(d => d.code === 'comparison-single-equals')).toHaveLength(0);
  });

  it('単一行 if（then で終わらない形式）は代入と区別できないため検出しない', () => {
    const diagnostics = analyzeTtl("if a == 1 messagebox 'x' 'y'");
    expect(diagnostics.filter(d => d.code === 'comparison-single-equals')).toHaveLength(0);
  });

  it('文字列内の = は検出しない', () => {
    const diagnostics = analyzeTtl("if strmatch = 0 then ; cond");
    // strmatch = 0 の = は検出されるが、コメントや文字列の = は対象外であることの確認
    const inString = analyzeTtl("sendln 'a = b'");
    expect(inString.filter(d => d.code === 'comparison-single-equals')).toHaveLength(0);
    expect(diagnostics.some(d => d.code === 'comparison-single-equals')).toBe(true);
  });
});

describe('analyzeTtl - 正常なスクリプト', () => {
  it('問題のないスクリプトでは診断を生成しない', () => {
    const text = [
      "connect 'host'",
      "wait '$'",
      'for i 1 10',
      '  if result == 0 then',
      '    break',
      '  endif',
      'next',
      'myvar = i + 1',
    ].join('\n');
    expect(analyzeTtl(text)).toHaveLength(0);
  });
});
