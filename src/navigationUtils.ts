/**
 * TTL ナビゲーション解析ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * アウトライン（シンボル）・参照検索・include 解決のための純粋関数を集約する。
 * VS Code 型に依存せず行・列の数値情報のみを返し、テスト容易性を確保する。
 */

import * as nodePath from 'node:path';
import { extractLabelDefinition, extractLabelReferences, stripLineComment } from './labelUtils';

/** include 文のパターン（シングルクォート内のパス） */
const INCLUDE_PATTERN = /\binclude\s+'([^']+)'/gi;

/** ソーステキストを行配列へ分割し、各行末の CR を除去 */
function splitLines(text: string): string[] {
  return text.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** シンボルの種別 */
export type TtlSymbolKind = 'label' | 'include';

/** アウトラインに表示する1件のシンボル情報 */
export interface TtlSymbol {
  /** 種別 */
  readonly kind: TtlSymbolKind;
  /** 表示名（ラベルは元の大文字小文字を保持、include はパス文字列） */
  readonly name: string;
  /** 0始まりの行番号 */
  readonly line: number;
  /** 行内の開始列（0始まり） */
  readonly startCharacter: number;
  /** 行内の終了列（0始まり、終端は含まない） */
  readonly endCharacter: number;
}

/** include 文1件分の情報 */
export interface IncludeDirective {
  /** include で指定された相対パス */
  readonly path: string;
  /** 0始まりの行番号 */
  readonly line: number;
  /** パス文字列の開始列（引用符の次、0始まり） */
  readonly startCharacter: number;
  /** パス文字列の終了列（0始まり、終端は含まない） */
  readonly endCharacter: number;
}

/** ラベルの出現箇所（定義または参照） */
export interface LabelOccurrence {
  /** 0始まりの行番号 */
  readonly line: number;
  /** ラベル名の開始列（0始まり） */
  readonly startCharacter: number;
  /** ラベル名の終了列（0始まり、終端は含まない） */
  readonly endCharacter: number;
  /** 定義（`:label`）なら true、参照（goto/call）なら false */
  readonly isDefinition: boolean;
}

/**
 * ソーステキストから全 include 文を抽出
 *
 * @remarks 行コメント（;）内の include は対象外とする
 * @param text - 解析対象のソーステキスト
 * @returns include 文の配列（出現順）
 */
export function extractIncludeDirectives(text: string): IncludeDirective[] {
  const results: IncludeDirective[] = [];
  splitLines(text).forEach((line, lineIndex) => {
    const effective = stripLineComment(line);
    INCLUDE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INCLUDE_PATTERN.exec(effective)) !== null) {
      const startCharacter = match.index + match[0].indexOf(match[1]);
      results.push({
        path: match[1],
        line: lineIndex,
        startCharacter,
        endCharacter: startCharacter + match[1].length,
      });
    }
  });
  return results;
}

/**
 * ソーステキストからアウトライン用シンボル（ラベル定義・include）を抽出
 *
 * @param text - 解析対象のソーステキスト
 * @returns 行順に並んだシンボルの配列
 */
export function extractDocumentSymbols(text: string): TtlSymbol[] {
  const symbols: TtlSymbol[] = [];

  splitLines(text).forEach((line, lineIndex) => {
    const def = extractLabelDefinition(line);
    if (def === null) return;
    // 表示用に元の大文字小文字を保持する
    const displayName = line.slice(def.nameStart, def.nameStart + def.name.length);
    symbols.push({
      kind: 'label',
      name: displayName,
      line: lineIndex,
      // 先頭のコロンを範囲に含める
      startCharacter: def.nameStart - 1,
      endCharacter: def.nameStart + def.name.length,
    });
  });

  for (const inc of extractIncludeDirectives(text)) {
    symbols.push({
      kind: 'include',
      name: inc.path,
      line: inc.line,
      startCharacter: inc.startCharacter,
      endCharacter: inc.endCharacter,
    });
  }

  symbols.sort((a, b) => a.line - b.line || a.startCharacter - b.startCharacter);
  return symbols;
}

/**
 * 指定ラベルの全出現箇所（定義・参照）を収集
 *
 * @param text - 解析対象のソーステキスト
 * @param name - 対象ラベル名（大文字小文字は区別しない）
 * @returns 出現箇所の配列（行順）
 */
export function collectLabelOccurrences(text: string, name: string): LabelOccurrence[] {
  const target = name.toLowerCase();
  const results: LabelOccurrence[] = [];

  splitLines(text).forEach((line, lineIndex) => {
    const def = extractLabelDefinition(line);
    if (def !== null && def.name === target) {
      results.push({
        line: lineIndex,
        startCharacter: def.nameStart,
        endCharacter: def.nameStart + def.name.length,
        isDefinition: true,
      });
    }

    for (const ref of extractLabelReferences(line)) {
      if (ref.name !== target) continue;
      results.push({
        line: lineIndex,
        startCharacter: ref.nameStart,
        endCharacter: ref.nameStart + ref.name.length,
        isDefinition: false,
      });
    }
  });

  return results;
}

/**
 * include パスを基準ディレクトリから絶対 fsPath へ解決
 *
 * @remarks
 * Tera Term では include 先の拡張子を省略できるため、拡張子が無い場合は `.ttl` を補完する。
 *
 * @param baseDir - 解決の基準ディレクトリ（最上位の親マクロのディレクトリ）
 * @param includePath - include で指定された相対パス
 * @returns 解決後の絶対パス
 */
export function resolveIncludeTarget(baseDir: string, includePath: string): string {
  const withExtension = nodePath.extname(includePath) === '' ? `${includePath}.ttl` : includePath;
  return nodePath.resolve(baseDir, withExtension);
}

/**
 * 対象ファイルの「最上位の親マクロ」ファイルを特定する
 *
 * @remarks
 * Tera Term の include はカレントディレクトリが最上位（エントリポイント）の親マクロの
 * 位置を基準とする。各ファイルの include を、その親の基準ディレクトリで解決しながら
 * 不動点反復で「ルート（最上位の親）」を下位へ伝播させる。親を持たないファイルは
 * 自分自身がルートとなる（＝従来同等のフォールバック）。
 *
 * @param targetFsPath - ルートを求めたいファイルの絶対パス
 * @param includeMap - 各 .ttl ファイル fsPath → そのファイルが持つ include パス文字列の配列
 * @returns 最上位の親マクロファイルの絶対パス（親が無ければ targetFsPath 自身）
 */
export function resolveIncludeRootFile(
  targetFsPath: string,
  includeMap: ReadonlyMap<string, readonly string[]>,
): string {
  // rootOf[f] = 現時点で判明している f のルート（最上位の親）ファイル
  const rootOf = new Map<string, string>();
  for (const fsPath of includeMap.keys()) rootOf.set(fsPath, fsPath);
  if (!rootOf.has(targetFsPath)) rootOf.set(targetFsPath, targetFsPath);

  // 循環 include を含むケースでも停止するよう反復回数に上限を設ける
  const maxIterations = includeMap.size + 1;
  let changed = true;
  for (let iteration = 0; changed && iteration < maxIterations; iteration++) {
    changed = false;
    for (const [parent, includes] of includeMap) {
      const parentRoot = rootOf.get(parent) ?? parent;
      const baseDir = nodePath.dirname(parentRoot);
      for (const includePath of includes) {
        const childFs = resolveIncludeTarget(baseDir, includePath);
        if (!rootOf.has(childFs)) continue; // ワークスペース外（実体なし）は無視
        if (rootOf.get(childFs) === parentRoot) continue;
        rootOf.set(childFs, parentRoot);
        changed = true;
      }
    }
  }

  return rootOf.get(targetFsPath) ?? targetFsPath;
}
