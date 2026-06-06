/**
 * TTL マクロ実行（Tera Term 起動）のための純粋ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * Tera Term の実行ディレクトリ解決、構造化された接続設定（`connect`）から CLI オプションへの変換、
 * および `ttermpro.exe` の起動引数の組み立てを集約し、テスト容易性を確保する。
 */

import * as nodePath from 'node:path';

/** Tera Term 本体（端末）の実行ファイル名 */
const TERATERM_EXE = 'ttermpro.exe';

/**
 * Tera Term の一般的なインストールディレクトリ候補
 *
 * @remarks Tera Term 5 系・4 系および 32bit/64bit のインストール先を順に探索する。
 */
export const DEFAULT_TERATERM_DIRS: readonly string[] = [
  'C:\\Program Files\\teraterm5',
  'C:\\Program Files (x86)\\teraterm5',
  'C:\\Program Files\\teraterm',
  'C:\\Program Files (x86)\\teraterm',
];

/**
 * 使用する Tera Term のインストールディレクトリを解決
 *
 * @remarks
 * - 設定値が指定されていれば、それを最優先で尊重する（存在チェックはせず、誤りは起動失敗として表面化させる）。
 * - 設定が空のときのみ、既定候補のうち `ttermpro.exe` が存在する最初のディレクトリを採用する。
 *
 * @param configuredDir - launch.json の `teraTermDir`（空文字可）
 * @param candidates - 自動探索する既定候補のディレクトリ配列
 * @param exists - パスの存在を判定する関数
 * @returns 使用するディレクトリ、または見つからない場合は null
 */
export function resolveTeraTermDir(
  configuredDir: string,
  candidates: readonly string[],
  exists: (path: string) => boolean,
): string | null {
  const trimmed = configuredDir.trim();
  if (trimmed.length > 0) return trimmed;

  for (const dir of candidates) {
    if (exists(nodePath.win32.join(dir, TERATERM_EXE))) return dir;
  }
  return null;
}

/** 接続プロトコル（`console` はシリアル接続） */
export type TtlConnectProto = 'ssh' | 'telnet' | 'console';

/**
 * 構造化された接続設定（launch.json の `connect`）
 *
 * @remarks Tera Term のコマンドラインオプションに変換される。
 */
export interface TtlConnect {
  /** 接続プロトコル。未指定なら comport/host から推測する */
  readonly proto?: TtlConnectProto;
  /** 接続先ホスト（ssh / telnet） */
  readonly host?: string;
  /** TCP ポート（ssh / telnet） */
  readonly port?: number;
  /** COM ポート番号 1〜256（console） */
  readonly comport?: number;
  /** ボーレート（console） */
  readonly speed?: number;
  /** データビット 7 / 8（console） */
  readonly cdatabit?: number;
  /** パリティ none / odd / even / mark / space（console） */
  readonly cparity?: string;
  /** ストップビット 1 / 1.5 / 2（console） */
  readonly cstopbit?: number;
  /** フロー制御 x / hard / none / rtscts / dsrdtr（console） */
  readonly cflowctrl?: string;
  /** 文字間ディレイ ms（console） */
  readonly cdelayperchar?: number;
  /** 行間ディレイ ms（console） */
  readonly cdelayperline?: number;
  /** 追加の生オプション（例: `['/auth=password', '/user=admin']`） */
  readonly options?: readonly string[];
}

/** 値が指定されている（null/undefined でない）か */
function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * 構造化された接続設定を Tera Term の CLI オプション配列に変換
 *
 * @remarks
 * - `ssh`: `<host>[:<port>] /ssh`
 * - `telnet`: `<host>[:<port>] /nossh /T=1`
 * - `console`（シリアル）: `/C=<comport> /BAUD=<speed> /CDATABIT=... /CPARITY=... ...`
 * - `proto` 未指定時は、comport があれば console、host があれば ssh と推測する。
 * - `options` は最後に生のまま付与する。
 *
 * @param connect - 接続設定
 * @returns Tera Term の CLI オプション配列
 */
export function buildConnectArgs(connect: TtlConnect): string[] {
  const args: string[] = [];
  const proto: TtlConnectProto | undefined =
    connect.proto ??
    (isPresent(connect.comport) ? 'console' : isPresent(connect.host) ? 'ssh' : undefined);

  if (proto === 'console') {
    if (isPresent(connect.comport)) args.push(`/C=${connect.comport}`);
    if (isPresent(connect.speed)) args.push(`/BAUD=${connect.speed}`);
    if (isPresent(connect.cdatabit)) args.push(`/CDATABIT=${connect.cdatabit}`);
    if (isPresent(connect.cparity)) args.push(`/CPARITY=${connect.cparity}`);
    if (isPresent(connect.cstopbit)) args.push(`/CSTOPBIT=${connect.cstopbit}`);
    if (isPresent(connect.cflowctrl)) args.push(`/CFLOWCTRL=${connect.cflowctrl}`);
    if (isPresent(connect.cdelayperchar)) args.push(`/CDELAYPERCHAR=${connect.cdelayperchar}`);
    if (isPresent(connect.cdelayperline)) args.push(`/CDELAYPERLINE=${connect.cdelayperline}`);
  } else if (proto === 'ssh' || proto === 'telnet') {
    const host = connect.host?.trim();
    if (isPresent(host) && host.length > 0) {
      args.push(isPresent(connect.port) ? `${host}:${connect.port}` : host);
    }
    if (proto === 'ssh') {
      args.push('/ssh');
    } else {
      // SSH へのフォールバックを避けるため /nossh を付け、明示的に telnet を有効化
      args.push('/nossh', '/T=1');
    }
  }

  if (Array.isArray(connect.options)) {
    for (const option of connect.options) {
      if (typeof option === 'string') args.push(option);
    }
  }

  return args;
}

/** 起動する実行ファイルと引数 */
export interface TeraTermLaunch {
  /** 実行ファイルの絶対パス */
  readonly executable: string;
  /** コマンドライン引数 */
  readonly args: readonly string[];
}

/**
 * `ttermpro.exe` の起動コマンドを組み立てる
 *
 * @remarks 引数は `<接続オプション...> /M=<program>` の順。実行ファイルは Windows パス規則で導出する。
 *
 * @param teraTermDir - 解決済みの Tera Term インストールディレクトリ
 * @param program - 実行するマクロファイルの絶対パス
 * @param connectArgs - {@link buildConnectArgs} で生成した接続オプション（省略時は接続なし）
 * @returns 実行ファイルと引数
 */
export function buildTeraTermLaunch(
  teraTermDir: string,
  program: string,
  connectArgs: readonly string[] = [],
): TeraTermLaunch {
  return {
    executable: nodePath.win32.join(teraTermDir, TERATERM_EXE),
    args: [...connectArgs, `/M=${program}`],
  };
}
