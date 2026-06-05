/**
 * TTL ラベル解析ユーティリティ（VS Code API 非依存）
 */

/** ラベル定義行のパターン（行頭コロン） */
const LABEL_DEFINITION_PATTERN = /^\s*:(\w+)/;

/** ラベル参照のパターン（goto/call の引数） */
const LABEL_REFERENCE_PATTERN = /\b(?:goto|call)\s+(\w+)/gi;

/**
 * 行テキストからラベル定義名とその開始列を抽出
 *
 * @param lineText - 対象行のテキスト
 * @returns ラベル名と名前部分の開始列、またはラベル定義でない場合は null
 */
export function extractLabelDefinition(
  lineText: string,
): { readonly name: string; readonly nameStart: number } | null {
  const match = LABEL_DEFINITION_PATTERN.exec(lineText);
  if (match === null) return null;
  const nameStart = lineText.indexOf(':' + match[1]) + 1;
  return { name: match[1].toLowerCase(), nameStart };
}

/**
 * 行コメント（;）より前の有効テキスト部分を返す
 *
 * @param lineText - 対象行のテキスト
 * @returns コメント除去後のテキスト
 */
export function stripLineComment(lineText: string): string {
  let inString = false;
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === "'") inString = !inString;
    if (!inString && lineText[i] === ';') return lineText.slice(0, i);
  }
  return lineText;
}

/**
 * 行テキストから goto/call によるラベル参照を全て抽出
 *
 * @param lineText - 対象行のテキスト
 * @returns ラベル名と名前部分の開始列の配列
 */
export function extractLabelReferences(
  lineText: string,
): ReadonlyArray<{ readonly name: string; readonly nameStart: number }> {
  const results: Array<{ readonly name: string; readonly nameStart: number }> = [];
  const effectiveText = stripLineComment(lineText);
  LABEL_REFERENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LABEL_REFERENCE_PATTERN.exec(effectiveText)) !== null) {
    const nameStart = match.index + match[0].indexOf(match[1]);
    results.push({ name: match[1].toLowerCase(), nameStart });
  }
  return results;
}
