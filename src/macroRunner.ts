/**
 * TTL マクロ実行のためのパス解決ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * `ttpmacro.exe` の場所を、ユーザー設定または一般的なインストール先から決定する純粋ロジックを集約し、
 * テスト容易性を確保する。実際のプロセス起動は VS Code 層（extension.ts）で行う。
 */

import * as nodePath from 'node:path';

/**
 * `ttpmacro.exe` の一般的なインストール先候補
 *
 * @remarks
 * Tera Term 5 系・4 系および 32bit/64bit のインストール先を順に探索する。
 * `ttpmacro.exe` は `ttermpro.exe` と同じフォルダに置かれる。
 */
export const DEFAULT_TTPMACRO_PATHS: readonly string[] = [
  'C:\\Program Files\\teraterm5\\ttpmacro.exe',
  'C:\\Program Files (x86)\\teraterm5\\ttpmacro.exe',
  'C:\\Program Files\\teraterm\\ttpmacro.exe',
  'C:\\Program Files (x86)\\teraterm\\ttpmacro.exe',
];

/**
 * 使用する `ttpmacro.exe` の実行パスを解決
 *
 * @remarks
 * - 設定値が指定されていれば、それを最優先で尊重する（存在チェックはせず、誤りは起動失敗として表面化させる）。
 * - 設定が空のときのみ、既定候補を順に存在チェックして最初に見つかったものを採用する。
 *
 * @param configuredPath - 設定 `ttl.macroExecutablePath` の値（空文字可）
 * @param candidates - 自動探索する既定候補のパス配列
 * @param exists - パスの存在を判定する関数
 * @returns 使用する実行パス、または見つからない場合は null
 */
export function resolveMacroExecutable(
  configuredPath: string,
  candidates: readonly string[],
  exists: (path: string) => boolean,
): string | null {
  const trimmed = configuredPath.trim();
  if (trimmed.length > 0) return trimmed;

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
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
 * `teraterm` 方式では、`ttpmacro.exe` と同じフォルダにある `ttermpro.exe` を Windows パス規則で導出する。
 *
 * @param ttpmacroPath - 解決済みの `ttpmacro.exe` パス
 * @param macroFilePath - 実行するマクロファイルの絶対パス
 * @param mode - 起動方式
 * @returns 実行ファイルと引数
 */
export function buildMacroLaunch(
  ttpmacroPath: string,
  macroFilePath: string,
  mode: RunMacroMode,
): MacroLaunch {
  if (mode === 'teraterm') {
    const teraTermPath = nodePath.win32.join(
      nodePath.win32.dirname(ttpmacroPath),
      'ttermpro.exe',
    );
    return { executable: teraTermPath, args: [`/M=${macroFilePath}`] };
  }
  return { executable: ttpmacroPath, args: [macroFilePath] };
}
