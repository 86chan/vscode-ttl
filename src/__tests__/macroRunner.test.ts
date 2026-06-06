/**
 * Tera Term 起動ロジックのユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 resolveTeraTermDir / buildTeraTermLaunch のみを対象とする。
 * 実プロセス起動・デバッグ構成の解決は対象外（拡張本体の責務）。
 */

import { describe, it, expect } from 'vitest';
import {
  buildTeraTermLaunch,
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

  it('設定が空のとき ttermpro.exe が存在する最初の候補ディレクトリを返す', () => {
    const candidates = ['C:\\none', 'C:\\hit'];
    const exists = (path: string): boolean => path === 'C:\\hit\\ttermpro.exe';
    expect(resolveTeraTermDir('', candidates, exists)).toBe('C:\\hit');
  });

  it('設定が空白のみのときも候補探索にフォールバックする', () => {
    expect(resolveTeraTermDir('   ', ['C:\\x'], ALWAYS_EXISTS)).toBe('C:\\x');
  });

  it('設定が空でどの候補にも ttermpro.exe が無ければ null を返す', () => {
    expect(resolveTeraTermDir('', DEFAULT_TERATERM_DIRS, NEVER_EXISTS)).toBeNull();
  });

  it('既定候補は teraterm5 / teraterm のディレクトリ', () => {
    expect(DEFAULT_TERATERM_DIRS[0]).toContain('teraterm5');
    expect(DEFAULT_TERATERM_DIRS.every(d => !d.endsWith('.exe'))).toBe(true);
  });
});

describe('buildTeraTermLaunch', () => {
  const DIR = 'C:\\Program Files\\teraterm5';
  const MACRO = 'C:\\Users\\me\\scripts\\login.ttl';

  it('実行ファイルは ttermpro.exe を Windows パス規則で導出する（実行ホスト非依存）', () => {
    expect(buildTeraTermLaunch('D:\\tt', MACRO).executable).toBe('D:\\tt\\ttermpro.exe');
  });

  it('host 指定時は host・接続オプション・/M= の順で引数を組み立てる', () => {
    const launch = buildTeraTermLaunch(DIR, MACRO, '192.168.1.10:22', ['/ssh', '/user=admin']);
    expect(launch.args).toEqual(['192.168.1.10:22', '/ssh', '/user=admin', `/M=${MACRO}`]);
  });

  it('host・connectOptions ともに無ければ /M= のみ', () => {
    expect(buildTeraTermLaunch(DIR, MACRO).args).toEqual([`/M=${MACRO}`]);
  });

  it('シリアル接続: host 無しでも connectOptions（/C= /BAUD=）を付与する', () => {
    const launch = buildTeraTermLaunch(DIR, MACRO, '', ['/C=1', '/BAUD=115200']);
    expect(launch.args).toEqual(['/C=1', '/BAUD=115200', `/M=${MACRO}`]);
  });

  it('host が空白のみでも connectOptions は付与する', () => {
    expect(buildTeraTermLaunch(DIR, MACRO, '   ', ['/C=3']).args).toEqual(['/C=3', `/M=${MACRO}`]);
  });

  it('host の前後空白はトリムする', () => {
    const launch = buildTeraTermLaunch(DIR, MACRO, '  host:22  ');
    expect(launch.args).toEqual(['host:22', `/M=${MACRO}`]);
  });
});
