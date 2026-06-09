/**
 * TTL マクロ実行（Tera Term 起動）のための純粋ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * Tera Term の実行ディレクトリ解決、構造化された接続設定（`connect`）および一般オプションから
 * CLI 引数への変換、`ttermpro.exe` の起動引数の組み立てを集約し、テスト容易性を確保する。
 */

import * as nodePath from 'node:path';

/** Tera Term 本体（端末）の実行ファイル名 */
const TERATERM_EXE = 'ttermpro.exe';

/** Tera Term マクロ実行専用の実行ファイル名 */
const TTPMACRO_EXE = 'ttpmacro.exe';

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

/** 値が指定されている（null/undefined でない）か */
function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** 接続プロトコル（`serial` はシリアル、`namedpipe` は名前付きパイプ） */
export type TtlConnectProto = 'ssh' | 'telnet' | 'serial' | 'namedpipe';

/**
 * 構造化された接続設定（launch.json の `connect`）
 *
 * @remarks Tera Term のコマンドラインオプションに変換される。
 */
export interface TtlConnect {
  /** 接続プロトコル。未指定なら comport/host から推測する */
  readonly proto?: TtlConnectProto;
  /** 接続先ホスト（ssh / telnet）または名前付きパイプのパス（namedpipe） */
  readonly host?: string;
  /** TCP ポート（ssh / telnet） */
  readonly port?: number;
  /** COM ポート番号 1〜256（serial） */
  readonly comport?: number;
  /** ボーレート（serial） */
  readonly speed?: number;
  /** データビット 7 / 8（serial） */
  readonly cdatabit?: number;
  /** パリティ none / odd / even / mark / space（serial） */
  readonly cparity?: string;
  /** ストップビット 1 / 1.5 / 2（serial） */
  readonly cstopbit?: number;
  /** フロー制御 x / hard / none / rtscts / dsrdtr（serial） */
  readonly cflowctrl?: string;
  /** 文字間ディレイ ms（serial） */
  readonly cdelayperchar?: number;
  /** 行間ディレイ ms（serial） */
  readonly cdelayperline?: number;
  /** Telnet バイナリオプション /B（telnet） */
  readonly binary?: boolean;
  /** シリアルポートが無ければ接続を待つ /WAITCOM（serial） */
  readonly waitcom?: boolean;
  /** 接続タイムアウト秒 /TIMEOUT= */
  readonly timeout?: number;
  /** 追加の生オプション（例: `['/auth=password', '/user=admin']`） */
  readonly options?: readonly string[];
}

/**
 * 構造化された接続設定を Tera Term の CLI オプション配列に変換
 *
 * @remarks
 * - `ssh`: `<host>[:<port>] /ssh`
 * - `telnet`: `<host>[:<port>] /nossh /T=1`
 * - `serial`（シリアル）: `/C=<comport> /BAUD=<speed> /CDATABIT=... ...`
 * - `namedpipe`: `<host(=pipe path)> /PIPE`
 * - `proto` 未指定時は、comport があれば serial、host があれば ssh と推測する。
 * - `binary` / `waitcom` / `timeout` / `options` は最後に付与する。
 *
 * @param connect - 接続設定
 * @returns Tera Term の CLI オプション配列
 */
export function buildConnectArgs(connect: TtlConnect): string[] {
  const args: string[] = [];
  const proto: TtlConnectProto | undefined =
    connect.proto ??
    (isPresent(connect.comport) ? 'serial' : isPresent(connect.host) ? 'ssh' : undefined);
  const host = connect.host?.trim();
  const hasHost = isPresent(host) && host.length > 0;

  if (proto === 'serial') {
    if (isPresent(connect.comport)) args.push(`/C=${connect.comport}`);
    if (isPresent(connect.speed)) args.push(`/BAUD=${connect.speed}`);
    if (isPresent(connect.cdatabit)) args.push(`/CDATABIT=${connect.cdatabit}`);
    if (isPresent(connect.cparity)) args.push(`/CPARITY=${connect.cparity}`);
    if (isPresent(connect.cstopbit)) args.push(`/CSTOPBIT=${connect.cstopbit}`);
    if (isPresent(connect.cflowctrl)) args.push(`/CFLOWCTRL=${connect.cflowctrl}`);
    if (isPresent(connect.cdelayperchar)) args.push(`/CDELAYPERCHAR=${connect.cdelayperchar}`);
    if (isPresent(connect.cdelayperline)) args.push(`/CDELAYPERLINE=${connect.cdelayperline}`);
    if (connect.waitcom === true) args.push('/WAITCOM');
  } else if (proto === 'namedpipe') {
    if (hasHost) args.push(host);
    args.push('/PIPE');
  } else if (proto === 'ssh' || proto === 'telnet') {
    if (hasHost) args.push(isPresent(connect.port) ? `${host}:${connect.port}` : host);
    if (proto === 'ssh') {
      args.push('/ssh');
    } else {
      // SSH へのフォールバックを避けるため /nossh を付け、明示的に telnet を有効化
      args.push('/nossh', '/T=1');
      if (connect.binary === true) args.push('/B');
    }
  }

  if (isPresent(connect.timeout)) args.push(`/TIMEOUT=${connect.timeout}`);

  if (Array.isArray(connect.options)) {
    for (const option of connect.options) {
      if (typeof option === 'string') args.push(option);
    }
  }

  return args;
}

/**
 * 接続以外の一般的な Tera Term 起動オプション（launch.json のトップレベル）
 *
 * @remarks 各フィールドは Tera Term のコマンドラインオプションに対応する。
 */
export interface TeraTermOptions {
  /** ウィンドウタイトル /W= */
  readonly windowTitle?: string;
  /** 設定ファイル /F= */
  readonly setupFile?: string;
  /** キーボード設定ファイル /K= */
  readonly keyboardFile?: string;
  /** 起動時にログ開始 /L= */
  readonly logFile?: string;
  /** 起動時にログを開始しない /NOLOG */
  readonly noLog?: boolean;
  /** 再生ファイル /R= */
  readonly replayFile?: string;
  /** ファイル転送ディレクトリ /FD= */
  readonly fileTransferDir?: string;
  /** テーマファイル /THEME= */
  readonly theme?: string;
  /** VT ウィンドウアイコン /VTICON= */
  readonly vtIcon?: string;
  /** TEK ウィンドウアイコン /TEKICON= */
  readonly tekIcon?: string;
  /** タイトルバーを隠す /H */
  readonly hideTitleBar?: boolean;
  /** アイコン状態で起動 /I */
  readonly iconify?: boolean;
  /** 非表示で起動 /V */
  readonly hidden?: boolean;
  /** ウィンドウ位置 X /X= */
  readonly windowX?: number;
  /** ウィンドウ位置 Y /Y= */
  readonly windowY?: number;
  /** 漢字コード（受信） /KR= */
  readonly kanjiReceive?: string;
  /** 漢字コード（送信） /KT= */
  readonly kanjiTransmit?: string;
  /** マルチキャスト名 /MN= */
  readonly multicastName?: string;
  /** クリップボードアクセス許可操作 /OSC52= */
  readonly osc52?: string;
  /** 切断時に自動でウィンドウを閉じる /AUTOWINCLOSE=on|off */
  readonly autoWinClose?: boolean;
  /** TCPLocalEcho/TCPCRSend を無効化 /E */
  readonly disableLocalEcho?: boolean;
  /** 起動時に「新しい接続」ダイアログを表示(true=/ES)／非表示(false=/DS) */
  readonly newConnectionDialog?: boolean;
}

/**
 * 一般的な Tera Term 起動オプションを CLI 引数配列に変換
 *
 * @param options - 一般オプション
 * @returns Tera Term の CLI オプション配列
 */
export function buildTeraTermOptions(options: TeraTermOptions): string[] {
  const args: string[] = [];

  const pushValue = (flag: string, value: string | number | undefined): void => {
    if (isPresent(value) && `${value}`.length > 0) args.push(`${flag}${value}`);
  };

  pushValue('/W=', options.windowTitle);
  pushValue('/F=', options.setupFile);
  pushValue('/K=', options.keyboardFile);
  pushValue('/L=', options.logFile);
  pushValue('/R=', options.replayFile);
  pushValue('/FD=', options.fileTransferDir);
  pushValue('/THEME=', options.theme);
  pushValue('/VTICON=', options.vtIcon);
  pushValue('/TEKICON=', options.tekIcon);
  pushValue('/X=', options.windowX);
  pushValue('/Y=', options.windowY);
  pushValue('/KR=', options.kanjiReceive);
  pushValue('/KT=', options.kanjiTransmit);
  pushValue('/MN=', options.multicastName);
  pushValue('/OSC52=', options.osc52);

  if (options.noLog === true) args.push('/NOLOG');
  if (options.hideTitleBar === true) args.push('/H');
  if (options.iconify === true) args.push('/I');
  if (options.hidden === true) args.push('/V');
  if (options.disableLocalEcho === true) args.push('/E');
  if (isPresent(options.autoWinClose)) args.push(`/AUTOWINCLOSE=${options.autoWinClose ? 'on' : 'off'}`);
  if (options.newConnectionDialog === true) args.push('/ES');
  else if (options.newConnectionDialog === false) args.push('/DS');

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
 * @remarks 引数は `<オプション...> /M=<program>` の順。実行ファイルは Windows パス規則で導出する。
 *
 * @param teraTermDir - 解決済みの Tera Term インストールディレクトリ
 * @param program - 実行するマクロファイルの絶対パス
 * @param optionArgs - 接続・一般オプションを連結した引数配列（省略時はオプションなし）
 * @returns 実行ファイルと引数
 */
export function buildTeraTermLaunch(
  teraTermDir: string,
  program: string,
  optionArgs: readonly string[] = [],
): TeraTermLaunch {
  return {
    executable: nodePath.win32.join(teraTermDir, TERATERM_EXE),
    args: [...optionArgs, `/M=${program}`],
  };
}

/**
 * 構造化された接続設定を TTL マクロの `connect` コマンド引数文字列に変換
 *
 * @remarks
 * `buildConnectArgs` の結果をスペースで結合した文字列を返す。
 * TTL の `connect 'string'` に直接渡すことを想定している。
 *
 * @param connect - 接続設定
 * @returns TTL connect コマンドに渡す引数文字列（例: `'192.168.0.100:22 /ssh'`）
 */
export function buildTtlConnectString(connect: TtlConnect): string {
  return buildConnectArgs(connect).join(' ');
}

/**
 * `ttpmacro.exe` の起動コマンドを組み立てる
 *
 * @remarks
 * 接続オプションは `ttpmacro.exe` に渡さない。接続は TTL マクロ内の `connect` コマンドで行う。
 * 実行ファイルは Windows パス規則で導出する。
 *
 * @param teraTermDir - 解決済みの Tera Term インストールディレクトリ
 * @param program - 実行するマクロファイルの絶対パス
 * @returns 実行ファイルと引数
 */
export function buildTtpMacroLaunch(teraTermDir: string, program: string): TeraTermLaunch {
  return {
    executable: nodePath.win32.join(teraTermDir, TTPMACRO_EXE),
    args: [program],
  };
}
