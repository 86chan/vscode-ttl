/**
 * マクロ実行パス解決のユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 resolveMacroExecutable のみを対象とする。
 * 実プロセス起動（child_process）の挙動は対象外。
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_TTPMACRO_PATHS, resolveMacroExecutable } from '../macroRunner';

const NEVER_EXISTS = (): boolean => false;
const ALWAYS_EXISTS = (): boolean => true;

describe('resolveMacroExecutable', () => {
  it('設定値が指定されていれば存在チェックせずそれを返す', () => {
    const configured = 'D:\\tools\\ttpmacro.exe';
    expect(resolveMacroExecutable(configured, DEFAULT_TTPMACRO_PATHS, NEVER_EXISTS)).toBe(configured);
  });

  it('設定値の前後空白をトリムする', () => {
    expect(resolveMacroExecutable('  C:\\a\\ttpmacro.exe  ', [], NEVER_EXISTS)).toBe(
      'C:\\a\\ttpmacro.exe',
    );
  });

  it('設定が空のとき最初に存在する候補を返す', () => {
    const candidates = ['C:\\none\\ttpmacro.exe', 'C:\\hit\\ttpmacro.exe'];
    const exists = (path: string): boolean => path === 'C:\\hit\\ttpmacro.exe';
    expect(resolveMacroExecutable('', candidates, exists)).toBe('C:\\hit\\ttpmacro.exe');
  });

  it('設定が空白のみのときも候補探索にフォールバックする', () => {
    expect(resolveMacroExecutable('   ', ['C:\\x\\ttpmacro.exe'], ALWAYS_EXISTS)).toBe(
      'C:\\x\\ttpmacro.exe',
    );
  });

  it('設定が空でどの候補も存在しなければ null を返す', () => {
    expect(resolveMacroExecutable('', DEFAULT_TTPMACRO_PATHS, NEVER_EXISTS)).toBeNull();
  });

  it('既定候補は teraterm5 / teraterm を順に探索する', () => {
    expect(DEFAULT_TTPMACRO_PATHS[0]).toContain('teraterm5');
    expect(DEFAULT_TTPMACRO_PATHS.every(p => p.endsWith('ttpmacro.exe'))).toBe(true);
  });
});
