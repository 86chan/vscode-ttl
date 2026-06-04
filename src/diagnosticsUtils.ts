/**
 * TTL 静的診断ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * 文字列・コメントを除外したうえで、無効な演算子およびシステム変数への
 * 代入を検出する。位置情報を保つため、対象外領域は同じ長さの空白でマスクする。
 */

/** 診断の重大度 */
export type TtlDiagnosticSeverity = 'error' | 'warning';

/** 診断1件分の情報 */
export interface TtlDiagnostic {
  /** 0始まりの行番号 */
  readonly line: number;
  /** 行内の開始列（0始まり） */
  readonly startCharacter: number;
  /** 行内の終了列（0始まり、終端は含まない） */
  readonly endCharacter: number;
  /** 表示メッセージ */
  readonly message: string;
  /** 重大度 */
  readonly severity: TtlDiagnosticSeverity;
  /** 診断種別コード */
  readonly code: string;
}

/**
 * 代入が推奨されない読み取り専用システム変数
 *
 * @remarks
 * timeout / mtimeout はユーザーが設定する書き込み可能な変数のため除外する
 */
const READONLY_SYSTEM_VARIABLES: ReadonlySet<string> = new Set([
  'result', 'inputstr', 'matchstr',
  'groupmatchstr1', 'groupmatchstr2', 'groupmatchstr3',
  'groupmatchstr4', 'groupmatchstr5', 'groupmatchstr6',
  'groupmatchstr7', 'groupmatchstr8', 'groupmatchstr9',
  'param1', 'param2', 'param3', 'param4', 'param5',
  'param6', 'param7', 'param8', 'param9',
  'params', 'paramcnt',
]);

/**
 * TTL に存在しない演算子と、推奨される代替表現
 *
 * @remarks 他言語からの誤用が多い記法を対象とする
 */
const INVALID_OPERATOR_HINTS: ReadonlyMap<string, string> = new Map([
  ['&&', "論理積は 'and' を使用"],
  ['||', "論理和は 'or' を使用"],
  ['**', 'べき乗演算子は未対応'],
  ['===', "等価比較は '=' または '==' を使用"],
  ['!==', "非等価比較は '<>' または '!=' を使用"],
  ['=>', "以上の比較は '>=' を使用"],
  ['+=', "複合代入は未対応（'a = a + b' と記述）"],
  ['-=', "複合代入は未対応（'a = a - b' と記述）"],
  ['*=', "複合代入は未対応（'a = a * b' と記述）"],
  ['/=', "複合代入は未対応（'a = a / b' と記述）"],
  ['%=', "複合代入は未対応（'a = a % b' と記述）"],
  ['++', "インクリメント演算子は未対応（'a = a + 1' と記述）"],
  ['--', "デクリメント演算子は未対応（'a = a - 1' と記述）"],
]);

// 長い記法を優先的にマッチさせるため、3文字の演算子を先頭に並べる
const INVALID_OPERATOR_PATTERN =
  /===|!==|&&|\|\||\*\*|=>|\+=|-=|\*=|\/=|%=|\+\+|--/g;

/** 行頭の代入文（var = ...、比較演算 == は除外） */
const ASSIGNMENT_PATTERN = /^(\s*)([A-Za-z_]\w*)\s*=(?!=)/;

/** if / elseif で始まる条件行（then で終わるブロック形式） */
const IF_CONDITION_OPENER = /^\s*(?:if|elseif)\b/i;

/** 条件行末尾の then */
const TRAILING_THEN = /\bthen\s*$/i;

/** while / until で始まり、行の残り全体が条件となる行 */
const REST_CONDITION_OPENER = /^\s*(?:while|until)\b/i;

/**
 * 文字列・コメントを同じ長さの空白に置き換えてコード部分のみを残す
 *
 * @remarks
 * - シングルクォート文字列、行コメント（;）、ブロックコメント（/​* *​/）をマスク
 * - ブロックコメントは行をまたぐため状態を引き継ぐ
 * - 列位置を保持するため、削除ではなく空白への置換を行う
 *
 * @param text - 対象ソーステキスト
 * @returns 行ごとのマスク済みテキスト配列
 */
function maskNonCode(text: string): string[] {
  const lines = text.split('\n');
  const maskedLines: string[] = [];
  let inBlockComment = false;

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    let masked = '';
    let inString = false;
    let index = 0;

    while (index < line.length) {
      const char = line[index];
      const nextChar = line[index + 1];

      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          masked += '  ';
          index += 2;
          inBlockComment = false;
          continue;
        }
        masked += ' ';
        index += 1;
        continue;
      }

      if (inString) {
        // TTL 文字列は行をまたがない（閉じクォートか行末で終端）
        masked += ' ';
        index += 1;
        if (char === "'") inString = false;
        continue;
      }

      if (char === ';') {
        // 行コメントは行末まで
        masked += ' '.repeat(line.length - index);
        break;
      }
      if (char === '/' && nextChar === '*') {
        masked += '  ';
        index += 2;
        inBlockComment = true;
        continue;
      }
      if (char === "'") {
        masked += ' ';
        index += 1;
        inString = true;
        continue;
      }

      masked += char;
      index += 1;
    }

    maskedLines.push(masked);
  }

  return maskedLines;
}

/**
 * マスク済み1行から無効な演算子を検出
 *
 * @param maskedLine - マスク済みの行テキスト
 * @param lineIndex - 0始まりの行番号
 * @returns 検出した診断の配列
 */
function findInvalidOperators(maskedLine: string, lineIndex: number): TtlDiagnostic[] {
  const diagnostics: TtlDiagnostic[] = [];
  INVALID_OPERATOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INVALID_OPERATOR_PATTERN.exec(maskedLine)) !== null) {
    const operator = match[0];
    const hint = INVALID_OPERATOR_HINTS.get(operator);
    const message = hint !== undefined
      ? `無効な演算子 "${operator}" — ${hint}`
      : `無効な演算子 "${operator}"`;
    diagnostics.push({
      line: lineIndex,
      startCharacter: match.index,
      endCharacter: match.index + operator.length,
      message,
      severity: 'error',
      code: 'invalid-operator',
    });
  }

  return diagnostics;
}

/**
 * マスク済み1行からシステム変数への代入を検出
 *
 * @param maskedLine - マスク済みの行テキスト
 * @param lineIndex - 0始まりの行番号
 * @returns 検出した診断、または該当なしの場合は null
 */
function findReservedAssignment(maskedLine: string, lineIndex: number): TtlDiagnostic | null {
  const match = ASSIGNMENT_PATTERN.exec(maskedLine);
  if (match === null) return null;

  const name = match[2].toLowerCase();
  if (!READONLY_SYSTEM_VARIABLES.has(name)) return null;

  const startCharacter = match[1].length;
  return {
    line: lineIndex,
    startCharacter,
    endCharacter: startCharacter + match[2].length,
    message: `'${name}' はシステムが値を設定するシステム変数のため、代入は推奨されません`,
    severity: 'warning',
    code: 'reserved-variable-assignment',
  };
}

/**
 * マスク済み1行から、条件式の範囲 [開始列, 終了列) を求める
 *
 * @remarks
 * - if / elseif は then で終わるブロック形式のみ対象とし、if と then の間を条件とする
 * - while / until は行の残り全体を条件とする
 * - 単一行 if（then 以降に文がある形式）は代入の = と区別できないため対象外
 *
 * @param maskedLine - マスク済みの行テキスト
 * @returns 条件式の範囲、または条件行でない場合は null
 */
function resolveConditionRange(
  maskedLine: string,
): { readonly start: number; readonly end: number } | null {
  const ifMatch = IF_CONDITION_OPENER.exec(maskedLine);
  if (ifMatch !== null) {
    const thenMatch = TRAILING_THEN.exec(maskedLine);
    if (thenMatch === null) return null;
    return { start: ifMatch[0].length, end: thenMatch.index };
  }

  const restMatch = REST_CONDITION_OPENER.exec(maskedLine);
  if (restMatch !== null) {
    return { start: restMatch[0].length, end: maskedLine.length };
  }

  return null;
}

/**
 * マスク済み1行の条件式から、比較に用いられた単独の = を検出
 *
 * @remarks
 * 条件式中の = は比較演算であり、== / <= / >= / != / => の一部は除外する。
 * 代入と紛らわしいため == の使用を推奨する。
 *
 * @param maskedLine - マスク済みの行テキスト
 * @param lineIndex - 0始まりの行番号
 * @returns 検出した診断の配列
 */
function findSingleEqualsComparison(maskedLine: string, lineIndex: number): TtlDiagnostic[] {
  const range = resolveConditionRange(maskedLine);
  if (range === null) return [];

  const diagnostics: TtlDiagnostic[] = [];
  for (let index = range.start; index < range.end; index++) {
    if (maskedLine[index] !== '=') continue;
    const previous = maskedLine[index - 1];
    const next = maskedLine[index + 1];
    // == / <= / >= / != / => の一部である = は比較記号として正しいので除外
    if (next === '=' || next === '>') continue;
    if (previous === '=' || previous === '<' || previous === '>' || previous === '!') continue;

    diagnostics.push({
      line: lineIndex,
      startCharacter: index,
      endCharacter: index + 1,
      message: "比較には '==' の使用を推奨します（'=' は代入と紛らわしいため）",
      severity: 'warning',
      code: 'comparison-single-equals',
    });
  }

  return diagnostics;
}

/**
 * TTL ソースコードを解析して診断一覧を生成
 *
 * @param text - 解析対象のソーステキスト
 * @returns 検出した診断の配列
 */
export function analyzeTtl(text: string): TtlDiagnostic[] {
  const maskedLines = maskNonCode(text);
  const diagnostics: TtlDiagnostic[] = [];

  maskedLines.forEach((maskedLine, lineIndex) => {
    diagnostics.push(...findInvalidOperators(maskedLine, lineIndex));
    diagnostics.push(...findSingleEqualsComparison(maskedLine, lineIndex));
    const reserved = findReservedAssignment(maskedLine, lineIndex);
    if (reserved !== null) diagnostics.push(reserved);
  });

  return diagnostics;
}
