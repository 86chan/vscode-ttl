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

describe('analyzeTtl - ブロックの閉じ忘れ・不一致', () => {
  it('endif の無い if ブロックを error として検出する', () => {
    const text = ['if a == 1 then', "  sendln 'x'"].join('\n');
    const diagnostic = analyzeTtl(text).find(d => d.code === 'unclosed-block');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.line).toBe(0);
    expect(diagnostic?.message).toContain('endif');
  });

  it('next の無い for ブロックを検出する', () => {
    const text = ['for i 1 10', '  mpause 1'].join('\n');
    const diagnostic = analyzeTtl(text).find(d => d.code === 'unclosed-block');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('next');
  });

  it('endwhile の無い while ブロックを検出する', () => {
    const diagnostic = analyzeTtl('while a == 0').find(d => d.code === 'unclosed-block');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('endwhile');
  });

  it('対応する開始の無い endif を error として検出する', () => {
    const diagnostic = analyzeTtl('endif').find(d => d.code === 'unmatched-block-close');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('error');
  });

  it('開始と一致しない終了キーワードを検出する', () => {
    // while を next で閉じようとしている
    const text = ['while a == 1', 'next'].join('\n');
    const diagnostic = analyzeTtl(text).find(d => d.code === 'mismatched-block-close');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('error');
  });

  it('単一行 if（then で終わらない）は endif を要求しない', () => {
    const diagnostics = analyzeTtl("if a == 1 messagebox 'x' 'y'");
    expect(diagnostics.filter(d => d.code === 'unclosed-block')).toHaveLength(0);
  });

  it('マクロ終了の end をブロック終了と誤認しない', () => {
    const text = ['if a == 1 then', "  sendln 'x'", '  end', 'endif'].join('\n');
    const diagnostics = analyzeTtl(text);
    expect(diagnostics.filter(d => d.code.startsWith('unclosed') || d.code.startsWith('unmatched') || d.code.startsWith('mismatched'))).toHaveLength(0);
  });

  it('正しく入れ子・閉じられたブロックは検出しない', () => {
    const text = [
      'for i 1 10',
      '  if a == 1 then',
      "    sendln 'x'",
      '  endif',
      'next',
    ].join('\n');
    const diagnostics = analyzeTtl(text);
    expect(diagnostics.filter(d =>
      ['unclosed-block', 'unmatched-block-close', 'mismatched-block-close'].includes(d.code),
    )).toHaveLength(0);
  });

  it('文字列・コメント内の endif はブロック終了と見なさない', () => {
    const text = ['if a == 1 then', "  sendln 'endif'", '  ; endif', 'endif'].join('\n');
    const diagnostics = analyzeTtl(text);
    expect(diagnostics.filter(d =>
      ['unclosed-block', 'unmatched-block-close', 'mismatched-block-close'].includes(d.code),
    )).toHaveLength(0);
  });
});

describe('analyzeTtl - 過剰なネスト', () => {
  it('既定の上限（2段）を超えるネストを warning として検出する', () => {
    const text = [
      'for i 1 10',          // 1段
      '  while a == 1',      // 2段
      '    if b == 2 then',  // 3段（上限超過）
      "      sendln 'x'",
      '    endif',
      '  endwhile',
      'next',
    ].join('\n');
    const diagnostics = analyzeTtl(text);
    const nesting = diagnostics.filter(d => d.code === 'excessive-nesting');
    expect(nesting).toHaveLength(1);
    expect(nesting[0].severity).toBe('warning');
    // 3段目（if）の行を指すこと
    expect(nesting[0].line).toBe(2);
    expect(nesting[0].message).toContain('3 段');
  });

  it('上限内（2段）のネストは検出しない', () => {
    const text = [
      'for i 1 10',
      '  if a == 1 then',
      "    sendln 'x'",
      '  endif',
      'next',
    ].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'excessive-nesting')).toHaveLength(0);
  });

  it('maxNestingDepth オプションで上限を変更できる', () => {
    const text = [
      'for i 1 10',
      '  if a == 1 then',
      "    sendln 'x'",
      '  endif',
      'next',
    ].join('\n');
    // 上限1段にすると2段目（if）が警告される
    const diagnostics = analyzeTtl(text, { maxNestingDepth: 1 });
    expect(diagnostics.filter(d => d.code === 'excessive-nesting')).toHaveLength(1);
  });

  it('maxNestingDepth が 0 の場合はネスト警告を無効化する', () => {
    const text = [
      'for i 1 10',
      '  while a == 1',
      '    if b == 2 then',
      "      sendln 'x'",
      '    endif',
      '  endwhile',
      'next',
    ].join('\n');
    expect(analyzeTtl(text, { maxNestingDepth: 0 }).filter(d => d.code === 'excessive-nesting')).toHaveLength(0);
  });
});

describe('analyzeTtl - 未知のコマンド', () => {
  it('タイプミスを warning として検出し近いコマンドを提案する', () => {
    const diagnostics = analyzeTtl("sendlm 'hello'");
    const diagnostic = diagnostics.find(d => d.code === 'unknown-command');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.message).toContain("'sendln'");
    // トークン部分だけを指すこと
    expect("sendlm 'hello'".slice(diagnostic!.startCharacter, diagnostic!.endCharacter)).toBe('sendlm');
  });

  it('既知のコマンド・キーワードは検出しない', () => {
    const text = [
      "connect 'host'",
      "wait '$'",
      'flushrecv',
      'for i 1 10',
      'next',
      'break',
      'return',
    ].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'unknown-command')).toHaveLength(0);
  });

  it('代入文・比較・配列アクセスは未知コマンドとして検出しない', () => {
    const text = [
      'myvar = 1',
      'result == 0',
      'fib[i] = fib[i - 1]',
      'count += 1',
      'i++',
    ].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'unknown-command')).toHaveLength(0);
  });

  it('ラベル定義・コメントは未知コマンドとして検出しない', () => {
    const text = [':do_login', '; just a comment', "  /* block */ wait '$'"].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'unknown-command')).toHaveLength(0);
  });

  it('近いコマンドが無ければ提案なしで検出する', () => {
    const diagnostic = analyzeTtl('zxqwvy 1 2 3').find(d => d.code === 'unknown-command');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).not.toContain('ことですか');
  });

  it('checkUnknownCommand=false で無効化できる', () => {
    const diagnostics = analyzeTtl("sendl 'x'", { checkUnknownCommand: false });
    expect(diagnostics.filter(d => d.code === 'unknown-command')).toHaveLength(0);
  });
});

describe('analyzeTtl - 重複ラベル定義', () => {
  it('同名ラベルの2回目の定義を warning として検出する', () => {
    const text = [':loop', "  sendln 'a'", ':loop', "  sendln 'b'"].join('\n');
    const diagnostics = analyzeTtl(text).filter(d => d.code === 'duplicate-label');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].line).toBe(2);
    expect(diagnostics[0].message).toContain('1 行目');
  });

  it('一意なラベルは検出しない', () => {
    const text = [':start', ':middle', ':end_proc'].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'duplicate-label')).toHaveLength(0);
  });

  it('大文字小文字を区別せず重複と見なす', () => {
    const text = [':Loop', ':loop'].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'duplicate-label')).toHaveLength(1);
  });

  it('checkDuplicateLabel=false で無効化できる', () => {
    const text = [':loop', ':loop'].join('\n');
    expect(
      analyzeTtl(text, { checkDuplicateLabel: false }).filter(d => d.code === 'duplicate-label'),
    ).toHaveLength(0);
  });
});

describe('analyzeTtl - 未定義ラベル参照', () => {
  it('定義の無い goto を warning として検出する', () => {
    const diagnostics = analyzeTtl('goto missing').filter(d => d.code === 'undefined-label');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect('goto missing'.slice(diagnostics[0].startCharacter, diagnostics[0].endCharacter)).toBe(
      'missing',
    );
  });

  it('同一ファイル内に定義があれば検出しない', () => {
    const text = ['call do_login', ':do_login', 'return'].join('\n');
    expect(analyzeTtl(text).filter(d => d.code === 'undefined-label')).toHaveLength(0);
  });

  it('externalLabels に含まれるラベルは検出しない', () => {
    const diagnostics = analyzeTtl('call remote_proc', {
      externalLabels: new Set(['remote_proc']),
    });
    expect(diagnostics.filter(d => d.code === 'undefined-label')).toHaveLength(0);
  });

  it('コメント内の goto は検出しない', () => {
    expect(analyzeTtl('; goto missing').filter(d => d.code === 'undefined-label')).toHaveLength(0);
  });

  it('checkUndefinedLabels=false で無効化できる', () => {
    const diagnostics = analyzeTtl('goto missing', { checkUndefinedLabels: false });
    expect(diagnostics.filter(d => d.code === 'undefined-label')).toHaveLength(0);
  });
});

describe('analyzeTtl - 同一ファイル限定モード（requireLabelInSameFile）', () => {
  it('include 先にしか定義が無いラベルを error として検出する', () => {
    const diagnostics = analyzeTtl('call remote_proc', {
      externalLabels: new Set(['remote_proc']),
      requireLabelInSameFile: true,
    });
    const errors = diagnostics.filter(d => d.code === 'label-not-in-file');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('通常モードでは include 先のラベルを受理する（比較用）', () => {
    const diagnostics = analyzeTtl('call remote_proc', {
      externalLabels: new Set(['remote_proc']),
    });
    expect(diagnostics.filter(d => d.code === 'label-not-in-file')).toHaveLength(0);
    expect(diagnostics.filter(d => d.code === 'undefined-label')).toHaveLength(0);
  });

  it('同一ファイル内に定義があれば検出しない', () => {
    const text = ['call do_login', ':do_login', 'return'].join('\n');
    const diagnostics = analyzeTtl(text, { requireLabelInSameFile: true });
    expect(diagnostics.filter(d => d.code === 'label-not-in-file')).toHaveLength(0);
  });

  it('どこにも定義の無いラベルも error として検出する', () => {
    const diagnostics = analyzeTtl('goto missing', { requireLabelInSameFile: true });
    const errors = diagnostics.filter(d => d.code === 'label-not-in-file');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
    // 通常の undefined-label（warning）は重複して出さない
    expect(diagnostics.filter(d => d.code === 'undefined-label')).toHaveLength(0);
  });

  it('checkUndefinedLabels=false なら同一ファイル限定モードでも検出しない', () => {
    const diagnostics = analyzeTtl('goto missing', {
      requireLabelInSameFile: true,
      checkUndefinedLabels: false,
    });
    expect(diagnostics.filter(d => d.code === 'label-not-in-file')).toHaveLength(0);
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

  it('ラベルを使う正常なスクリプトでは診断を生成しない', () => {
    const text = [
      'call do_login',
      'goto finish',
      ':do_login',
      "  sendln 'login'",
      '  return',
      ':finish',
      '  end',
    ].join('\n');
    expect(analyzeTtl(text)).toHaveLength(0);
  });
});
