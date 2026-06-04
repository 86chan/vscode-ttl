/**
 * TTL コード整形ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * ブロック構造（if/for/while/do/until など）のネストに応じて
 * 各行のインデントを再計算する。文字列・コメント内のキーワードは無視する。
 */

/** 整形オプション */
export interface FormatOptions {
  /** インデント1段分の文字列（例: 2スペースなら '  '、タブなら '\t'） */
  readonly indentUnit: string;
}

/** デフォルトの整形オプション（半角スペース2つ） */
export const DEFAULT_FORMAT_OPTIONS: FormatOptions = { indentUnit: '  ' };

/** ネストを1段深くするブロック開始キーワード（`if` を除く） */
const BLOCK_OPEN_KEYWORDS = new Set(['for', 'while', 'do', 'until']);

/** ネストを1段浅くするブロック終了キーワード */
const BLOCK_CLOSE_KEYWORDS = new Set(['next', 'endwhile', 'loop', 'enduntil', 'endif']);

/** 自身は浅く、後続は深くする中間キーワード（if ブロック内の分岐） */
const BLOCK_MIDDLE_KEYWORDS = new Set(['else', 'elseif']);

/**
 * 行から文字列リテラルと行コメント（;）を除去し、構文解析用のテキストを返す
 *
 * @param lineText - 対象行のテキスト
 * @returns 文字列・コメントを取り除いたテキスト
 */
function stripStringsAndComment(lineText: string): string {
  let result = '';
  let inString = false;
  for (let i = 0; i < lineText.length; i++) {
    const char = lineText[i];
    if (char === "'") {
      inString = !inString;
      continue;
    }
    if (!inString && char === ';') break;
    if (!inString) result += char;
  }
  return result;
}

/**
 * 整形用に分解した1行の情報
 *
 * @remarks 空行・ラベル・ブロックキーワードの種別を保持する
 */
interface LineClassification {
  /** トリム済みの行本文 */
  readonly trimmed: string;
  /** 空行かどうか */
  readonly isBlank: boolean;
  /** ラベル定義行（行頭コロン）かどうか */
  readonly isLabel: boolean;
  /** この行を出力する前にネストを1段浅くするか */
  readonly dedentSelf: boolean;
  /** この行の後でネストを1段深くするか */
  readonly indentAfter: boolean;
}

/**
 * 1行を分類し、インデント調整に必要な情報を求める
 *
 * @param lineText - 対象行のテキスト
 * @returns 行分類
 */
function classifyLine(lineText: string): LineClassification {
  const trimmed = lineText.trim();
  if (trimmed.length === 0) {
    return { trimmed, isBlank: true, isLabel: false, dedentSelf: false, indentAfter: false };
  }
  if (trimmed.startsWith(':')) {
    return { trimmed, isBlank: false, isLabel: true, dedentSelf: false, indentAfter: false };
  }

  const code = stripStringsAndComment(lineText).trim().toLowerCase();
  const tokens = code.split(/\s+/).filter(token => token.length > 0);
  const firstToken = tokens[0] ?? '';
  const lastToken = tokens[tokens.length - 1] ?? '';

  // `if ... then` および `elseif ... then` は then で終わる場合のみブロックを開く
  // （単一行 if は then の後にコマンドが続くため開かない）
  const opensIfBlock = firstToken === 'if' && lastToken === 'then';
  const isMiddle = BLOCK_MIDDLE_KEYWORDS.has(firstToken);
  const isClose = BLOCK_CLOSE_KEYWORDS.has(firstToken);
  const isOpen = BLOCK_OPEN_KEYWORDS.has(firstToken) || opensIfBlock;

  return {
    trimmed,
    isBlank: false,
    isLabel: false,
    dedentSelf: isClose || isMiddle,
    indentAfter: isOpen || isMiddle,
  };
}

/**
 * TTL ソースコードを整形（再インデント）する
 *
 * @remarks
 * - 各行の前後の空白を除去し、ブロックのネスト深さに応じたインデントを付与する
 * - 空行は空行のまま保持する
 * - ラベル定義行（:name）は常にインデント0に揃える
 * - 文字列・コメント内のキーワードはネスト計算に影響しない
 *
 * @param text - 整形対象のソーステキスト
 * @param options - 整形オプション
 * @returns 整形後のソーステキスト
 */
export function formatTtl(text: string, options: FormatOptions = DEFAULT_FORMAT_OPTIONS): string {
  const lines = text.split('\n');
  const formatted: string[] = [];
  let depth = 0;

  for (const rawLine of lines) {
    // 行末の CR（CRLF 由来）を保持して後で復元する
    const hasCarriageReturn = rawLine.endsWith('\r');
    const line = hasCarriageReturn ? rawLine.slice(0, -1) : rawLine;

    const info = classifyLine(line);

    if (info.isBlank) {
      // 空行は完全に空（末尾空白なし）にする
      formatted.push(hasCarriageReturn ? '\r' : '');
      continue;
    }

    if (info.dedentSelf) {
      depth = Math.max(0, depth - 1);
    }

    const effectiveDepth = info.isLabel ? 0 : depth;
    const indent = options.indentUnit.repeat(effectiveDepth);
    formatted.push(indent + info.trimmed + (hasCarriageReturn ? '\r' : ''));

    if (info.indentAfter) {
      depth += 1;
    }
  }

  return formatted.join('\n');
}
