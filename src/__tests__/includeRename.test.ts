/**
 * include パスのリネーム追従ロジックのユニットテスト
 *
 * @remarks
 * `buildIncludeRenameEdit` は VS Code API に依存するため直接テストできない。
 * 正規表現マッチとパス解決のロジックを独立した関数として抽出してテストする。
 */

import * as nodePath from 'node:path';
import { describe, it, expect } from 'vitest';

// ── テスト対象ロジック（extension.ts からの抽出） ─────────────────────────────

const INCLUDE_PATTERN = /\binclude\s+'([^']+)'/gi;

/**
 * 行テキストから include パスのマッチ情報を列挙
 *
 * @param lineText - 対象行のテキスト
 * @returns マッチした include パスと開始列インデックスのペア
 */
function extractIncludePaths(lineText: string): Array<{ path: string; start: number }> {
  const results: Array<{ path: string; start: number }> = [];
  INCLUDE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INCLUDE_PATTERN.exec(lineText)) !== null) {
    const pathStart = match.index + match[0].indexOf(match[1]);
    results.push({ path: match[1], start: pathStart });
  }
  return results;
}

/**
 * 旧ファイルパスへの include を新パスに置換するテキストを計算
 *
 * @param includedRelative - include 文中の相対パス
 * @param fileDir - include 文を含むファイルのディレクトリ
 * @param oldAbsolute - リネーム前の絶対パス
 * @param newAbsolute - リネーム後の絶対パス
 * @returns 置換後の相対パス、または null（対象外の場合）
 */
function resolveNewIncludePath(
  includedRelative: string,
  fileDir: string,
  oldAbsolute: string,
  newAbsolute: string,
): string | null {
  const includedAbsolute = nodePath.resolve(fileDir, includedRelative);
  if (includedAbsolute !== oldAbsolute) return null;
  return nodePath.relative(fileDir, newAbsolute).replace(/\\/g, '/');
}

// ── extractIncludePaths テスト ────────────────────────────────────────────────

describe('extractIncludePaths', () => {
  it('シンプルな include を検出する', () => {
    const result = extractIncludePaths("include 'sub/helper.ttl'");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('sub/helper.ttl');
  });

  it('インデント付き include を検出する', () => {
    const result = extractIncludePaths("  include 'lib.ttl'");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('lib.ttl');
  });

  it('include が大文字小文字を問わずマッチする', () => {
    const result = extractIncludePaths("INCLUDE 'utils.ttl'");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('utils.ttl');
  });

  it('include でない行は空を返す', () => {
    expect(extractIncludePaths('; include は無効行')).toHaveLength(0);
    expect(extractIncludePaths("sendln 'hello'")).toHaveLength(0);
    expect(extractIncludePaths('')).toHaveLength(0);
  });

  it('start が引用符の中のパス開始位置を指す', () => {
    const line = "include 'sub/file.ttl'";
    const result = extractIncludePaths(line);
    expect(result[0].start).toBe(line.indexOf('sub/file.ttl'));
  });
});

// ── resolveNewIncludePath テスト ─────────────────────────────────────────────

describe('resolveNewIncludePath', () => {
  const sep = nodePath.sep;
  const root = sep === '\\' ? 'C:\\project' : '/project';
  const fileDir = nodePath.join(root, 'macros');
  const oldAbsolute = nodePath.join(root, 'lib', 'old.ttl');
  const newAbsolute = nodePath.join(root, 'lib', 'new.ttl');

  it('リネーム対象ファイルへの include を新パスに解決する', () => {
    const result = resolveNewIncludePath('../lib/old.ttl', fileDir, oldAbsolute, newAbsolute);
    expect(result).toBe('../lib/new.ttl');
  });

  it('別ファイルへの include は null を返す', () => {
    const result = resolveNewIncludePath('../lib/other.ttl', fileDir, oldAbsolute, newAbsolute);
    expect(result).toBeNull();
  });

  it('同じディレクトリ内のリネームを解決する', () => {
    const sameDir = nodePath.join(root, 'lib');
    const result = resolveNewIncludePath('old.ttl', sameDir, oldAbsolute, newAbsolute);
    expect(result).toBe('new.ttl');
  });

  it('パス区切り文字がスラッシュに正規化される', () => {
    const result = resolveNewIncludePath('../lib/old.ttl', fileDir, oldAbsolute, newAbsolute);
    expect(result).not.toContain('\\');
  });
});
