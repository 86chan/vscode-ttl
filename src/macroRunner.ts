/**
 * TTL マクロ実行のためのパス解決ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * Tera Term の実行ファイルが置かれたディレクトリを、ユーザー設定または一般的なインストール先から決定する
 * 純粋ロジックを集約し、テスト容易性を確保する。実際のプロセス起動は VS Code 層（extension.ts）で行う。
 */

import * as nodePath from 'node:path';

/** マクロエンジンの実行ファイル名 */
const TTPMACRO_EXE = 'ttpmacro.exe';

/** Tera Term 本体（端末）の実行ファイル名 */
const TERATERM_EXE = 'ttermpro.exe';

/**
 * Tera Term の一般的なインストールディレクトリ候補
 *
 * @remarks
 * Tera Term 5 系・4 系および 32bit/64bit のインストール先を順に探索する。
 * このディレクトリに `ttpmacro.exe` と `ttermpro.exe` が同居している。
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
 * - 設定が空のときのみ、既定候補のうち `ttpmacro.exe` が存在する最初のディレクトリを採用する。
 *
 * @param configuredDir - 設定 `ttl.teraTermDir` の値（空文字可）
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
    if (exists(nodePath.win32.join(dir, TTPMACRO_EXE))) return dir;
  }
  return null;
}

/**
 * マクロの起動方式
 *
 * @remarks
 * - `teraterm`: `ttermpro.exe /M=<file>` で起動。先に Tera Term（端末）を立ち上げてマクロを連携させるため、
 *   `connect` 前でも `clearscreen` 等の端末コマンドが使える。
 * - `ttpmacro`: `ttpmacro.exe <file>` でマクロエンジンのみ起動。端末はマクロ内の `connect` で初めて連携する。
 */
export type RunMacroMode = 'teraterm' | 'ttpmacro';

/** 起動する実行ファイルと引数 */
export interface MacroLaunch {
  /** 実行ファイルの絶対パス */
  readonly executable: string;
  /** コマンドライン引数 */
  readonly args: readonly string[];
}

/**
 * 起動方式に応じて実行ファイルと引数を組み立てる
 *
 * @remarks
 * 実行ファイルは Tera Term ディレクトリから Windows パス規則で導出する。
 *
 * @param teraTermDir - 解決済みの Tera Term インストールディレクトリ
 * @param macroFilePath - 実行するマクロファイルの絶対パス
 * @param mode - 起動方式
 * @returns 実行ファイルと引数
 */
export function buildMacroLaunch(
  teraTermDir: string,
  macroFilePath: string,
  mode: RunMacroMode,
): MacroLaunch {
  if (mode === 'teraterm') {
    return {
      executable: nodePath.win32.join(teraTermDir, TERATERM_EXE),
      args: [`/M=${macroFilePath}`],
    };
  }
  return {
    executable: nodePath.win32.join(teraTermDir, TTPMACRO_EXE),
    args: [macroFilePath],
  };
}
