/**
 * TTL マクロ実行（Tera Term 起動）のための純粋ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * Tera Term の実行ファイルが置かれたディレクトリの解決と、`ttermpro.exe` の起動引数の組み立てを集約し、
 * テスト容易性を確保する。実際のプロセス起動とデバッグ構成の解決は VS Code 層（extension.ts）で行う。
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
 * @remarks
 * 引数は `<host?> <connectOptions...> /M=<program>` の順。
 * - TCP/IP 接続: `host` に接続先（例 `192.168.1.10:22`）、`connectOptions` に `['/ssh', ...]` を指定。
 * - シリアル接続: `host` は空のまま、`connectOptions` に `['/C=1', '/BAUD=115200']` 等を指定。
 * - `host` も `connectOptions` も無ければ `ttermpro.exe /M=<program>` のみ（接続はマクロ内の `connect` に委ねる）。
 *
 * `connectOptions` は `host` の有無に関係なく常に付与する（シリアル接続は host を持たないため）。
 * 実行ファイルは Windows パス規則で導出する。
 *
 * @param teraTermDir - 解決済みの Tera Term インストールディレクトリ
 * @param program - 実行するマクロファイルの絶対パス
 * @param host - TCP/IP 接続先（例: `192.168.1.10:22`）。未指定/空なら付与しない
 * @param connectOptions - 接続オプション（例: `['/ssh']` や `['/C=1', '/BAUD=115200']`）
 * @returns 実行ファイルと引数
 */
export function buildTeraTermLaunch(
  teraTermDir: string,
  program: string,
  host?: string,
  connectOptions: readonly string[] = [],
): TeraTermLaunch {
  const args: string[] = [];
  const trimmedHost = host?.trim();
  if (trimmedHost !== undefined && trimmedHost.length > 0) {
    args.push(trimmedHost);
  }
  args.push(...connectOptions);
  args.push(`/M=${program}`);
  return {
    executable: nodePath.win32.join(teraTermDir, TERATERM_EXE),
    args,
  };
}
