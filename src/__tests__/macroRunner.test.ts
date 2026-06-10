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
  buildTeraTermOptions,
  buildTtlConnectString,
  buildTtpMacroAttachLaunch,
  buildTtpMacroLaunch,
  DEFAULT_TERATERM_DIRS,
  ENUM_VT_WINDOWS_PS_SCRIPT,
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

  it('serial: 指定したシリアルパラメータを /Cxxx= オプションに変換する', () => {
    const args = buildConnectArgs({
      proto: 'serial',
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

  it('serial: 未指定の項目はオプションを出さない', () => {
    expect(buildConnectArgs({ proto: 'serial', comport: 1 })).toEqual(['/C=1']);
  });

  it('proto 省略時は comport があれば serial と推測する', () => {
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

  it('telnet: binary(/B) と timeout を付与する', () => {
    expect(
      buildConnectArgs({ proto: 'telnet', host: 'h', binary: true, timeout: 15 }),
    ).toEqual(['h', '/nossh', '/T=1', '/B', '/TIMEOUT=15']);
  });

  it('serial: waitcom(/WAITCOM) を付与する', () => {
    expect(buildConnectArgs({ proto: 'serial', comport: 1, waitcom: true })).toEqual([
      '/C=1',
      '/WAITCOM',
    ]);
  });

  it('namedpipe: パスと /PIPE を生成する', () => {
    expect(buildConnectArgs({ proto: 'namedpipe', host: '\\\\.\\pipe\\foo' })).toEqual([
      '\\\\.\\pipe\\foo',
      '/PIPE',
    ]);
  });
});

describe('buildTeraTermOptions', () => {
  it('値オプションを /FLAG=value 形式で生成する', () => {
    const args = buildTeraTermOptions({
      windowTitle: 'My Session',
      setupFile: 'C:\\tt\\my.ini',
      logFile: 'C:\\logs\\a.log',
      windowX: 100,
      windowY: 50,
      theme: 'dark',
    });
    expect(args).toEqual([
      '/W=My Session',
      '/F=C:\\tt\\my.ini',
      '/L=C:\\logs\\a.log',
      '/THEME=dark',
      '/X=100',
      '/Y=50',
    ]);
  });

  it('真偽フラグは true のときだけ付与する', () => {
    expect(buildTeraTermOptions({ hidden: true, iconify: true, hideTitleBar: true, noLog: true })).toEqual([
      '/NOLOG',
      '/H',
      '/I',
      '/V',
    ]);
    expect(buildTeraTermOptions({ hidden: false })).toEqual([]);
  });

  it('autoWinClose は on/off に変換する', () => {
    expect(buildTeraTermOptions({ autoWinClose: true })).toEqual(['/AUTOWINCLOSE=on']);
    expect(buildTeraTermOptions({ autoWinClose: false })).toEqual(['/AUTOWINCLOSE=off']);
  });

  it('newConnectionDialog は true=/ES, false=/DS, 未指定=なし', () => {
    expect(buildTeraTermOptions({ newConnectionDialog: true })).toEqual(['/ES']);
    expect(buildTeraTermOptions({ newConnectionDialog: false })).toEqual(['/DS']);
    expect(buildTeraTermOptions({})).toEqual([]);
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

describe('buildTtlConnectString', () => {
  it('SSH: buildConnectArgs の結果をスペース結合した文字列を返す', () => {
    expect(buildTtlConnectString({ proto: 'ssh', host: '192.168.0.100', port: 22 })).toBe(
      '192.168.0.100:22 /ssh',
    );
  });

  it('serial: シリアルオプションをスペース結合する', () => {
    expect(buildTtlConnectString({ proto: 'serial', comport: 3, speed: 115200 })).toBe(
      '/C=3 /BAUD=115200',
    );
  });

  it('空の接続設定では空文字列を返す', () => {
    expect(buildTtlConnectString({})).toBe('');
  });
});

describe('buildTtpMacroLaunch', () => {
  const DIR = 'C:\\Program Files\\teraterm5';
  const MACRO = 'C:\\Users\\me\\scripts\\login.ttl';

  it('実行ファイルは ttpmacro.exe を Windows パス規則で導出する', () => {
    expect(buildTtpMacroLaunch('D:\\tt', MACRO).executable).toBe('D:\\tt\\ttpmacro.exe');
  });

  it('引数はマクロパスのみ（接続オプションなし）', () => {
    expect(buildTtpMacroLaunch(DIR, MACRO).args).toEqual([MACRO]);
  });
});

describe('buildTtpMacroAttachLaunch', () => {
  const DIR = 'C:\\Program Files\\teraterm5';
  const MACRO = 'C:\\Users\\me\\scripts\\login.ttl';
  const HWND = '001A0042';

  it('実行ファイルは ttpmacro.exe を Windows パス規則で導出する', () => {
    expect(buildTtpMacroAttachLaunch(DIR, HWND, MACRO).executable).toBe(
      `${DIR}\\ttpmacro.exe`,
    );
  });

  it('引数は /D=<hwndHex> <macro> の順', () => {
    expect(buildTtpMacroAttachLaunch(DIR, HWND, MACRO).args).toEqual([`/D=${HWND}`, MACRO]);
  });
});

describe('ENUM_VT_WINDOWS_PS_SCRIPT', () => {
  it('VTWin32 クラス名を含む', () => {
    expect(ENUM_VT_WINDOWS_PS_SCRIPT).toContain('VTWin32');
  });

  it('HWND を X8 形式（8 桁 16 進）でフォーマットする', () => {
    expect(ENUM_VT_WINDOWS_PS_SCRIPT).toContain('X8');
  });
});
