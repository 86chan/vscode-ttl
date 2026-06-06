/**
 * Tera Term 起動ロジックのユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 resolveTeraTermDir / buildTeraTermLaunch のみを対象とする。
 * 実プロセス起動・デバッグ構成の解決は対象外（拡張本体の責務）。
 */

import { describe, it, expect } from 'vitest';
import {
  buildConnectArgs,
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

describe('buildConnectArgs', () => {
  it('ssh: host:port と /ssh を生成する', () => {
    expect(buildConnectArgs({ proto: 'ssh', host: '192.168.0.100', port: 22 })).toEqual([
      '192.168.0.100:22',
      '/ssh',
    ]);
  });

  it('ssh: port 省略時は host のみ + /ssh', () => {
    expect(buildConnectArgs({ proto: 'ssh', host: 'myhost' })).toEqual(['myhost', '/ssh']);
  });

  it('telnet: host:port と /nossh /T=1 を生成する', () => {
    expect(buildConnectArgs({ proto: 'telnet', host: 'myhost', port: 23 })).toEqual([
      'myhost:23',
      '/nossh',
      '/T=1',
    ]);
  });

  it('console: 指定したシリアルパラメータを /Cxxx= オプションに変換する', () => {
    const args = buildConnectArgs({
      proto: 'console',
      comport: 3,
      speed: 115200,
      cdatabit: 8,
      cparity: 'none',
      cstopbit: 1,
      cflowctrl: 'hard',
      cdelayperchar: 0,
      cdelayperline: 5,
    });
    expect(args).toEqual([
      '/C=3',
      '/BAUD=115200',
      '/CDATABIT=8',
      '/CPARITY=none',
      '/CSTOPBIT=1',
      '/CFLOWCTRL=hard',
      '/CDELAYPERCHAR=0',
      '/CDELAYPERLINE=5',
    ]);
  });

  it('console: 未指定の項目はオプションを出さない', () => {
    expect(buildConnectArgs({ proto: 'console', comport: 1 })).toEqual(['/C=1']);
  });

  it('proto 省略時は comport があれば console と推測する', () => {
    expect(buildConnectArgs({ comport: 5, speed: 9600 })).toEqual(['/C=5', '/BAUD=9600']);
  });

  it('proto 省略時は host があれば ssh と推測する', () => {
    expect(buildConnectArgs({ host: 'h', port: 22 })).toEqual(['h:22', '/ssh']);
  });

  it('options は生のまま末尾に付与する', () => {
    expect(
      buildConnectArgs({ proto: 'ssh', host: 'h', options: ['/auth=password', '/user=admin'] }),
    ).toEqual(['h', '/ssh', '/auth=password', '/user=admin']);
  });

  it('空の接続設定では何も生成しない', () => {
    expect(buildConnectArgs({})).toEqual([]);
  });
});

describe('buildTeraTermLaunch', () => {
  const DIR = 'C:\\Program Files\\teraterm5';
  const MACRO = 'C:\\Users\\me\\scripts\\login.ttl';

  it('実行ファイルは ttermpro.exe を Windows パス規則で導出する（実行ホスト非依存）', () => {
    expect(buildTeraTermLaunch('D:\\tt', MACRO).executable).toBe('D:\\tt\\ttermpro.exe');
  });

  it('接続オプション・/M= の順で引数を組み立てる', () => {
    const launch = buildTeraTermLaunch(DIR, MACRO, ['192.168.0.100:22', '/ssh']);
    expect(launch.args).toEqual(['192.168.0.100:22', '/ssh', `/M=${MACRO}`]);
  });

  it('接続オプションが無ければ /M= のみ', () => {
    expect(buildTeraTermLaunch(DIR, MACRO).args).toEqual([`/M=${MACRO}`]);
  });
});
