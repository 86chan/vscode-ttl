/**
 * TTL 静的診断ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * 文字列・コメントを除外したうえで、無効な演算子およびシステム変数への
 * 代入を検出する。位置情報を保つため、対象外領域は同じ長さの空白でマスクする。
 */

import { extractLabelDefinition, extractLabelReferences } from './labelUtils';
import { TTL_COMMANDS_MAP, TTL_STRUCTURAL_KEYWORDS, TTL_SYSTEM_VARIABLES } from './ttlData';

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

/** 行頭の最初のキーワードトークン（ラベルや記号は対象外） */
const FIRST_TOKEN_PATTERN = /^\s*([A-Za-z]\w*)/;

/**
 * ブロック開始キーワードと、対応する終了キーワード
 *
 * @remarks `end`（マクロ終了）はブロック閉じではないため対象外
 */
const BLOCK_OPENERS: ReadonlyMap<string, string> = new Map([
  ['if', 'endif'],
  ['for', 'next'],
  ['while', 'endwhile'],
  ['do', 'loop'],
  ['until', 'enduntil'],
]);

/** ブロック終了キーワードと、対応する開始キーワード */
const BLOCK_CLOSERS: ReadonlyMap<string, string> = new Map([
  ['endif', 'if'],
  ['next', 'for'],
  ['endwhile', 'while'],
  ['loop', 'do'],
  ['enduntil', 'until'],
]);

/**
 * 行頭トークンとして正当なコマンド・キーワード（小文字）
 *
 * @remarks これらに一致しない行頭トークンは未知コマンドの候補とする
 */
const KNOWN_COMMAND_TOKENS: ReadonlySet<string> = new Set<string>([
  ...TTL_COMMANDS_MAP.keys(),
  ...TTL_STRUCTURAL_KEYWORDS,
]);

/** 未知コマンド判定で除外するシステム変数（小文字） */
const SYSTEM_VARIABLE_TOKENS: ReadonlySet<string> = new Set<string>(TTL_SYSTEM_VARIABLES);

/** 未知コマンド候補のサジェスト対象（コマンド名・キーワードのみ） */
const SUGGESTION_CANDIDATES: readonly string[] = [...KNOWN_COMMAND_TOKENS];

/**
 * 行頭トークンの直後が代入・比較・配列アクセスを表す場合の先頭文字集合
 *
 * @remarks `var = ...` / `var == ...` / `a[i] = ...` / `i++` など、コマンド呼び出しでない行を除外する
 */
const NON_COMMAND_FOLLOWERS: ReadonlySet<string> = new Set<string>([
  '=', '<', '>', '!', '+', '-', '*', '/', '%', '[',
]);

/** サジェストを行う最小トークン長（短い語の偶然一致を避ける） */
const MIN_SUGGESTION_LENGTH = 3;

/** サジェストとして採用する最大編集距離 */
const MAX_SUGGESTION_DISTANCE = 2;

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
 * 2語間のレーベンシュタイン距離を計算
 *
 * @param a - 比較元の文字列
 * @param b - 比較先の文字列
 * @returns 編集距離
 */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  let current = new Array<number>(cols).fill(0);

  for (let i = 1; i < rows; i++) {
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1, // 削除
        current[j - 1] + 1, // 挿入
        previous[j - 1] + cost, // 置換
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[cols - 1];
}

/**
 * 未知トークンに最も近い既知コマンド名を提案
 *
 * @param token - 未知の行頭トークン（小文字）
 * @returns 編集距離が閾値以内で最も近いコマンド名、または該当なしの場合は undefined
 */
function suggestCommand(token: string): string | undefined {
  if (token.length < MIN_SUGGESTION_LENGTH) return undefined;

  let best: string | undefined;
  let bestDistance = MAX_SUGGESTION_DISTANCE + 1;
  for (const candidate of SUGGESTION_CANDIDATES) {
    // 長さ差が閾値を超える候補は計算を省略
    if (Math.abs(candidate.length - token.length) > MAX_SUGGESTION_DISTANCE) continue;
    const distance = levenshtein(token, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= MAX_SUGGESTION_DISTANCE ? best : undefined;
}

/**
 * マスク済み1行から未知のコマンド（行頭トークン）を検出
 *
 * @remarks
 * - ラベル定義・空行・記号始まりの行は対象外（行頭トークンが取れない）
 * - 既知のコマンド・キーワード・システム変数は対象外
 * - 代入・比較・配列アクセス（`var = ` / `var == ` / `a[i] = ` / `i++` 等）は対象外
 *
 * @param maskedLine - マスク済みの行テキスト
 * @param lineIndex - 0始まりの行番号
 * @returns 検出した診断、または該当なしの場合は null
 */
function findUnknownCommand(maskedLine: string, lineIndex: number): TtlDiagnostic | null {
  const tokenMatch = FIRST_TOKEN_PATTERN.exec(maskedLine);
  if (tokenMatch === null) return null;

  const rawToken = tokenMatch[1];
  const token = rawToken.toLowerCase();
  if (KNOWN_COMMAND_TOKENS.has(token) || SYSTEM_VARIABLE_TOKENS.has(token)) return null;

  // 行頭トークン直後が演算子・代入・配列アクセスならコマンド呼び出しではない
  const afterToken = maskedLine.slice(tokenMatch[0].length).trimStart();
  const follower = afterToken[0];
  if (follower !== undefined && NON_COMMAND_FOLLOWERS.has(follower)) return null;

  const startCharacter = tokenMatch[0].length - rawToken.length;
  const suggestion = suggestCommand(token);
  const message = suggestion !== undefined
    ? `未知のコマンド '${rawToken}' — '${suggestion}' のことですか？`
    : `未知のコマンド '${rawToken}'`;

  return {
    line: lineIndex,
    startCharacter,
    endCharacter: startCharacter + rawToken.length,
    message,
    severity: 'warning',
    code: 'unknown-command',
  };
}

/**
 * マスク済み行配列から重複したラベル定義を検出
 *
 * @param maskedLines - マスク済みの行テキスト配列
 * @returns 2回目以降の定義に対する診断の配列
 */
function findDuplicateLabels(maskedLines: readonly string[]): TtlDiagnostic[] {
  const diagnostics: TtlDiagnostic[] = [];
  const firstSeenLine = new Map<string, number>();

  maskedLines.forEach((maskedLine, lineIndex) => {
    const def = extractLabelDefinition(maskedLine);
    if (def === null) return;

    const previousLine = firstSeenLine.get(def.name);
    if (previousLine === undefined) {
      firstSeenLine.set(def.name, lineIndex);
      return;
    }

    diagnostics.push({
      line: lineIndex,
      startCharacter: def.nameStart,
      endCharacter: def.nameStart + def.name.length,
      message: `ラベル ':${def.name}' は ${previousLine + 1} 行目で既に定義されています`,
      severity: 'warning',
      code: 'duplicate-label',
    });
  });

  return diagnostics;
}

/**
 * マスク済み行配列から、定義の無いラベル参照（goto/call）を検出
 *
 * @param maskedLines - マスク済みの行テキスト配列
 * @param externalLabels - include 先など外部で定義済みのラベル名（小文字）
 * @param sameFileOnly - true の場合、include 先の定義を受理せず同一ファイル内の定義のみを許可し
 *   （externalLabels は無視）、見つからない参照を error として報告する
 * @returns 検出した診断の配列
 */
function findUndefinedLabels(
  maskedLines: readonly string[],
  externalLabels: ReadonlySet<string>,
  sameFileOnly: boolean,
): TtlDiagnostic[] {
  const localLabels = new Set<string>();
  for (const maskedLine of maskedLines) {
    const def = extractLabelDefinition(maskedLine);
    if (def !== null) localLabels.add(def.name);
  }

  const diagnostics: TtlDiagnostic[] = [];
  maskedLines.forEach((maskedLine, lineIndex) => {
    for (const ref of extractLabelReferences(maskedLine)) {
      if (localLabels.has(ref.name)) continue;
      if (!sameFileOnly && externalLabels.has(ref.name)) continue;
      diagnostics.push({
        line: lineIndex,
        startCharacter: ref.nameStart,
        endCharacter: ref.nameStart + ref.name.length,
        message: sameFileOnly
          ? `ラベル ':${ref.name}' の定義が同一ファイル内に見つかりません`
          : `ラベル ':${ref.name}' の定義が見つかりません`,
        severity: sameFileOnly ? 'error' : 'warning',
        code: sameFileOnly ? 'label-not-in-file' : 'undefined-label',
      });
    }
  });

  return diagnostics;
}

/** 解析中に保持する未閉鎖のブロック情報 */
interface OpenBlock {
  /** 開始キーワード */
  readonly keyword: string;
  /** 対応する終了キーワード */
  readonly expectedCloser: string;
  /** 0始まりの行番号 */
  readonly line: number;
  /** キーワードの開始列 */
  readonly startCharacter: number;
  /** キーワードの終了列 */
  readonly endCharacter: number;
}

/**
 * ブロックのネスト構造を走査し、閉じ忘れ・不一致・過剰なネストを検出
 *
 * @remarks
 * - 終了キーワードに対応する開始がない場合や、開始が閉じられないまま終端した場合をエラーとする
 * - ネスト段数が上限を超えた開始ブロックを警告する（上限0以下で無効化）
 *
 * @param maskedLines - マスク済みの行テキスト配列
 * @param maxNestingDepth - 許容するネスト段数の上限
 * @returns 検出した診断の配列
 */
function findBlockStructureIssues(
  maskedLines: readonly string[],
  maxNestingDepth: number,
): TtlDiagnostic[] {
  const diagnostics: TtlDiagnostic[] = [];
  const stack: OpenBlock[] = [];

  maskedLines.forEach((maskedLine, lineIndex) => {
    const tokenMatch = FIRST_TOKEN_PATTERN.exec(maskedLine);
    if (tokenMatch === null) return;

    const keyword = tokenMatch[1].toLowerCase();
    const startCharacter = tokenMatch[0].length - tokenMatch[1].length;
    const endCharacter = tokenMatch[0].length;

    const expectedCloser = BLOCK_OPENERS.get(keyword);
    if (expectedCloser !== undefined) {
      // if は then で終わるブロック形式のみブロックを開く（単一行 if は除外）
      if (keyword === 'if' && !TRAILING_THEN.test(maskedLine)) return;

      stack.push({ keyword, expectedCloser, line: lineIndex, startCharacter, endCharacter });

      if (maxNestingDepth > 0 && stack.length > maxNestingDepth) {
        diagnostics.push({
          line: lineIndex,
          startCharacter,
          endCharacter,
          message: `ネストが深すぎます（${stack.length} 段、上限 ${maxNestingDepth} 段）`,
          severity: 'warning',
          code: 'excessive-nesting',
        });
      }
      return;
    }

    const expectedOpener = BLOCK_CLOSERS.get(keyword);
    if (expectedOpener === undefined) return;

    const top = stack[stack.length - 1];
    if (top === undefined) {
      diagnostics.push({
        line: lineIndex,
        startCharacter,
        endCharacter,
        message: `'${keyword}' に対応する '${expectedOpener}' がありません`,
        severity: 'error',
        code: 'unmatched-block-close',
      });
      return;
    }

    stack.pop();
    if (top.keyword !== expectedOpener) {
      diagnostics.push({
        line: lineIndex,
        startCharacter,
        endCharacter,
        message: `'${keyword}' は ${top.line + 1} 行目の '${top.keyword}' に対応していません`,
        severity: 'error',
        code: 'mismatched-block-close',
      });
    }
  });

  // 終端まで閉じられなかった開始ブロック
  for (const block of stack) {
    diagnostics.push({
      line: block.line,
      startCharacter: block.startCharacter,
      endCharacter: block.endCharacter,
      message: `'${block.keyword}' ブロックが '${block.expectedCloser}' で閉じられていません`,
      severity: 'error',
      code: 'unclosed-block',
    });
  }

  return diagnostics;
}

/** analyzeTtl の解析オプション */
export interface AnalyzeOptions {
  /** 許容するネスト段数の上限（既定 2、0以下で無効化） */
  readonly maxNestingDepth?: number;
  /** include 先など外部で定義済みのラベル名（小文字）。undefined-label の誤検知抑制に使用 */
  readonly externalLabels?: ReadonlySet<string>;
  /** 定義の無いラベル参照を検査するか（既定 true、include 解決が不完全な場合は false 推奨） */
  readonly checkUndefinedLabels?: boolean;
  /**
   * ラベルを同一ファイル内で完結させることを要求するか（既定 false）。
   * true の場合、include 先の定義を受理せず、同一ファイルに定義の無い参照を error として報告する。
   */
  readonly requireLabelInSameFile?: boolean;
  /** 未知のコマンドを検査するか（既定 true） */
  readonly checkUnknownCommand?: boolean;
  /** 重複したラベル定義を検査するか（既定 true） */
  readonly checkDuplicateLabel?: boolean;
}

/** ネスト段数上限の既定値 */
export const DEFAULT_MAX_NESTING_DEPTH = 2;

/** 外部ラベル未指定時に使う空集合 */
const EMPTY_LABEL_SET: ReadonlySet<string> = new Set<string>();

/**
 * TTL ソースコードを解析して診断一覧を生成
 *
 * @param text - 解析対象のソーステキスト
 * @param options - 解析オプション
 * @returns 検出した診断の配列
 */
export function analyzeTtl(text: string, options: AnalyzeOptions = {}): TtlDiagnostic[] {
  const maxNestingDepth = options.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH;
  const checkUndefinedLabels = options.checkUndefinedLabels ?? true;
  const requireLabelInSameFile = options.requireLabelInSameFile ?? false;
  const checkUnknownCommand = options.checkUnknownCommand ?? true;
  const checkDuplicateLabel = options.checkDuplicateLabel ?? true;
  const externalLabels = options.externalLabels ?? EMPTY_LABEL_SET;
  const maskedLines = maskNonCode(text);
  const diagnostics: TtlDiagnostic[] = [];

  maskedLines.forEach((maskedLine, lineIndex) => {
    diagnostics.push(...findInvalidOperators(maskedLine, lineIndex));
    diagnostics.push(...findSingleEqualsComparison(maskedLine, lineIndex));
    const reserved = findReservedAssignment(maskedLine, lineIndex);
    if (reserved !== null) diagnostics.push(reserved);
    if (checkUnknownCommand) {
      const unknown = findUnknownCommand(maskedLine, lineIndex);
      if (unknown !== null) diagnostics.push(unknown);
    }
  });

  if (checkDuplicateLabel) diagnostics.push(...findDuplicateLabels(maskedLines));
  if (checkUndefinedLabels) {
    diagnostics.push(...findUndefinedLabels(maskedLines, externalLabels, requireLabelInSameFile));
  }
  diagnostics.push(...findBlockStructureIssues(maskedLines, maxNestingDepth));

  return diagnostics;
}
