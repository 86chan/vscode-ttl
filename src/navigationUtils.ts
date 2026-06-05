/**
 * TTL ナビゲーション解析ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * アウトライン（シンボル）・参照検索・include 解決のための純粋関数を集約する。
 * VS Code 型に依存せず行・列の数値情報のみを返し、テスト容易性を確保する。
 */

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
