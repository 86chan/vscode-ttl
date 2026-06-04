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

/** markdown テーブルの列揃え種別 */
type ColumnAlign = 'none' | 'left' | 'right' | 'center';

/**
 * 1文字の表示幅（East Asian Width）を求める
 *
 * @remarks
 * CJK 統合漢字・かな・全角記号・絵文字などは幅2、それ以外は幅1として扱う。
 * 等幅フォント上での桁揃えに用いる近似値。
 *
 * @param codePoint - 対象文字のコードポイント
 * @returns 表示幅（1 または 2）
 */
function charDisplayWidth(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // ハングル字母
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK 部首・康熙部首・記述記号
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // ひらがな・カタカナ・CJK 記号
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK 拡張A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK 統合漢字
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // イ文字
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // ハングル音節
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK 互換漢字
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK 互換形
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // 全角英数・記号
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // 全角記号
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // 絵文字
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK 拡張B以降
  ) {
    return 2;
  }
  return 1;
}

/**
 * 文字列の表示幅（等幅フォント換算）を求める
 *
 * @param text - 対象文字列
 * @returns 表示幅の合計
 */
function stringDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charDisplayWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

/** コメントテーブルの1行（コメント記号とセル配列に分解したもの） */
interface CommentTableRow {
  /** 行頭のコメント記号（正規化後、例: `'; '`） */
  readonly marker: string;
  /** セルの内容（前後空白を除去済み） */
  readonly cells: readonly string[];
}

/**
 * 行をコメントテーブル行として解釈する
 *
 * @remarks
 * 行頭（先頭空白を除く）が `;` で始まり、コメント本文が `|` で始まる行のみ対象。
 * それ以外（コード行・通常のコメント行）は null を返す。
 *
 * @param line - 対象行（CR 除去済み）
 * @returns 分解結果、テーブル行でなければ null
 */
function parseCommentTableRow(line: string): CommentTableRow | null {
  const match = /^[ \t]*(;+)[ \t]?(.*)$/.exec(line);
  if (match === null) return null;
  const body = match[2].trim();
  if (!body.startsWith('|')) return null;

  let inner = body.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  const cells = inner.split('|').map(cell => cell.trim());
  return { marker: `${match[1]} `, cells };
}

/**
 * セル配列が markdown テーブルの区切り行（`---` の並び）かどうか判定する
 *
 * @param cells - セル配列
 * @returns 区切り行なら true
 */
function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));
}

/**
 * 区切りセルの記述から列揃えを求める
 *
 * @param cell - 区切りセル（例: `':---:'`）
 * @returns 列揃え種別
 */
function parseColumnAlign(cell: string): ColumnAlign {
  const hasLeft = cell.startsWith(':');
  const hasRight = cell.endsWith(':');
  if (hasLeft && hasRight) return 'center';
  if (hasRight) return 'right';
  if (hasLeft) return 'left';
  return 'none';
}

/**
 * セルを指定幅まで空白で詰める（表示幅基準）
 *
 * @param cell - セル内容
 * @param width - 目標表示幅
 * @param align - 列揃え種別
 * @returns 桁揃え後のセル文字列
 */
function padCell(cell: string, width: number, align: ColumnAlign): string {
  const pad = width - stringDisplayWidth(cell);
  if (pad <= 0) return cell;
  if (align === 'right') return ' '.repeat(pad) + cell;
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + cell + ' '.repeat(pad - left);
  }
  return cell + ' '.repeat(pad);
}

/**
 * 区切りセルを指定幅・指定揃えで生成する
 *
 * @param width - 目標表示幅
 * @param align - 列揃え種別
 * @returns 区切りセル文字列（例: `':----:'`）
 */
function buildSeparatorCell(width: number, align: ColumnAlign): string {
  switch (align) {
    case 'left':
      return `:${'-'.repeat(Math.max(1, width - 1))}`;
    case 'right':
      return `${'-'.repeat(Math.max(1, width - 1))}:`;
    case 'center':
      return `:${'-'.repeat(Math.max(1, width - 2))}:`;
    default:
      return '-'.repeat(width);
  }
}

/**
 * コメントテーブルの連続行を桁揃えする
 *
 * @param rows - テーブルを構成する行（区切り行を含む）
 * @param separatorIndex - 区切り行のインデックス
 * @returns 整形後の各行テキスト
 */
function formatCommentTableBlock(rows: readonly CommentTableRow[], separatorIndex: number): string[] {
  const aligns = rows[separatorIndex].cells.map(parseColumnAlign);
  const columnCount = Math.max(...rows.map(row => row.cells.length));

  const widths: number[] = [];
  for (let col = 0; col < columnCount; col++) {
    // markdown の最小（区切りの `---`）として 3 を下限にする
    let width = 3;
    for (let r = 0; r < rows.length; r++) {
      if (r === separatorIndex) continue;
      width = Math.max(width, stringDisplayWidth(rows[r].cells[col] ?? ''));
    }
    widths[col] = width;
  }

  return rows.map((row, rowIndex) => {
    const cells: string[] = [];
    for (let col = 0; col < columnCount; col++) {
      const align = aligns[col] ?? 'none';
      cells.push(
        rowIndex === separatorIndex
          ? buildSeparatorCell(widths[col], align)
          : padCell(row.cells[col] ?? '', widths[col], align),
      );
    }
    return `${row.marker}| ${cells.join(' | ')} |`;
  });
}

/**
 * コメント内に書かれた markdown テーブルを桁揃えする
 *
 * @remarks
 * 連続するコメントテーブル行（`; | ... |`）のうち、2行目が区切り行
 * （`; | --- | --- |`）になっている正当なテーブルのみを対象とする。
 * 全角文字は表示幅2として扱い、等幅フォント上で桁が揃うよう整える。
 *
 * @param lines - CR 除去済みの行配列
 * @returns テーブル部分を整形した行配列（行数は不変）
 */
function formatCommentTables(lines: readonly string[]): string[] {
  const result = [...lines];
  let i = 0;
  while (i < lines.length) {
    if (parseCommentTableRow(lines[i]) === null) {
      i++;
      continue;
    }

    const rows: CommentTableRow[] = [];
    let j = i;
    while (j < lines.length) {
      const parsed = parseCommentTableRow(lines[j]);
      if (parsed === null) break;
      rows.push(parsed);
      j++;
    }

    // 2行目が区切り行の正当なテーブルのみ整形する
    if (rows.length >= 2 && isSeparatorRow(rows[1].cells)) {
      const formatted = formatCommentTableBlock(rows, 1);
      for (let k = 0; k < formatted.length; k++) {
        result[i + k] = formatted[k];
      }
    }
    i = j;
  }
  return result;
}

/**
 * TTL ソースコードを整形（再インデント）する
 *
 * @remarks
 * - 各行の前後の空白を除去し、ブロックのネスト深さに応じたインデントを付与する
 * - 空行は空行のまま保持する
 * - ラベル定義行（:name）は常にインデント0に揃える
 * - 文字列・コメント内のキーワードはネスト計算に影響しない
 * - コメント内に書かれた markdown テーブルは桁揃えする（全角文字対応）
 *
 * @param text - 整形対象のソーステキスト
 * @param options - 整形オプション
 * @returns 整形後のソーステキスト
 */
export function formatTtl(text: string, options: FormatOptions = DEFAULT_FORMAT_OPTIONS): string {
  const rawLines = text.split('\n');
  // CR（CRLF 由来）を退避してから論理行を整形する
  const carriageReturns = rawLines.map(rawLine => rawLine.endsWith('\r'));
  const logicalLines = formatCommentTables(
    rawLines.map((rawLine, index) => (carriageReturns[index] ? rawLine.slice(0, -1) : rawLine)),
  );

  const formatted: string[] = [];
  let depth = 0;

  for (let index = 0; index < logicalLines.length; index++) {
    const hasCarriageReturn = carriageReturns[index];
    const line = logicalLines[index];

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
