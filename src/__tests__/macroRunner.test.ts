/**
 * マクロ実行パス解決のユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 resolveTeraTermDir / buildMacroLaunch のみを対象とする。
 * 実プロセス起動（child_process）の挙動は対象外。
 */

import { describe, it, expect } from 'vitest';
import {
  buildMacroLaunch,
  DEFAULT_TERATERM_DIRS,
  resolveTeraTermDir,
} from '../macroRunner';

const NEVER_EXISTS = (): boolean => false;
const ALWAYS_EXISTS = (): boolean => true;

describe('resolveTeraTermDir', () => {
  it('設定値が指定されていれば存在チェックせずそれを返す', () => {
    const configured = 'D:\\tools\\teraterm';
    expect(resolveTeraTermDir(configured, DEFAULT_TERATERM_DIRS, NEVER_EXISTS)).toBe(configured);
  });

  it('設定値の前後空白をトリムする', () => {
    expect(resolveTeraTermDir('  C:\\a\\teraterm  ', [], NEVER_EXISTS)).toBe('C:\\a\\teraterm');
  });

  it('設定が空のとき ttpmacro.exe が存在する最初の候補ディレクトリを返す', () => {
    const candidates = ['C:\\none', 'C:\\hit'];
    const exists = (path: string): boolean => path === 'C:\\hit\\ttpmacro.exe';
    expect(resolveTeraTermDir('', candidates, exists)).toBe('C:\\hit');
  });

  it('設定が空白のみのときも候補探索にフォールバックする', () => {
    expect(resolveTeraTermDir('   ', ['C:\\x'], ALWAYS_EXISTS)).toBe('C:\\x');
  });

  it('設定が空でどの候補にも ttpmacro.exe が無ければ null を返す', () => {
    expect(resolveTeraTermDir('', DEFAULT_TERATERM_DIRS, NEVER_EXISTS)).toBeNull();
  });

  it('既定候補は teraterm5 / teraterm のディレクトリ', () => {
    expect(DEFAULT_TERATERM_DIRS[0]).toContain('teraterm5');
    expect(DEFAULT_TERATERM_DIRS.every(d => !d.endsWith('.exe'))).toBe(true);
  });
});

describe('buildMacroLaunch', () => {
  const DIR = 'C:\\Program Files\\teraterm5';
  const MACRO = 'C:\\Users\\me\\scripts\\login.ttl';

  it('teraterm 方式は ttermpro.exe を /M= で起動する', () => {
    const launch = buildMacroLaunch(DIR, MACRO, 'teraterm');
    expect(launch.executable).toBe('C:\\Program Files\\teraterm5\\ttermpro.exe');
    expect(launch.args).toEqual([`/M=${MACRO}`]);
  });

  it('ttpmacro 方式は ttpmacro.exe にファイルパスを渡す', () => {
    const launch = buildMacroLaunch(DIR, MACRO, 'ttpmacro');
    expect(launch.executable).toBe('C:\\Program Files\\teraterm5\\ttpmacro.exe');
    expect(launch.args).toEqual([MACRO]);
  });

  it('実行ファイルは Windows パス規則で導出する（実行ホスト非依存）', () => {
    expect(buildMacroLaunch('D:\\tt', MACRO, 'teraterm').executable).toBe('D:\\tt\\ttermpro.exe');
    expect(buildMacroLaunch('D:\\tt', MACRO, 'ttpmacro').executable).toBe('D:\\tt\\ttpmacro.exe');
  });

  it('teraterm 方式で showNewConnectionDialog を指定すると /ES を /M= の前に付与する', () => {
    const launch = buildMacroLaunch(DIR, MACRO, 'teraterm', { showNewConnectionDialog: true });
    expect(launch.args).toEqual(['/ES', `/M=${MACRO}`]);
  });

  it('showNewConnectionDialog 未指定なら /ES を付けない', () => {
    expect(buildMacroLaunch(DIR, MACRO, 'teraterm').args).toEqual([`/M=${MACRO}`]);
  });

  it('ttpmacro 方式では showNewConnectionDialog を無視する', () => {
    const launch = buildMacroLaunch(DIR, MACRO, 'ttpmacro', { showNewConnectionDialog: true });
    expect(launch.args).toEqual([MACRO]);
  });
});
