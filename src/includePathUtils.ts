/**
 * include パス補完・修正候補のための解析ユーティリティ（VS Code API 非依存）
 *
 * @remarks
 * `include 'path'` 入力中のカーソル文脈解析と、未検出 include に対する類似パス順位付けを
 * 純粋関数として集約し、テスト容易性を確保する。
 */

import * as nodePath from 'node:path';
import { levenshtein } from './diagnosticsUtils';
import { stripLineComment } from './labelUtils';

/** 入力中の include パスを補完するための文脈情報 */
export interface IncludePathContext {
  /** 引用符開始からカーソルまでに入力済みのパス文字列全体 */
  readonly typed: string;
  /** 入力済みパスのディレクトリ部分（最後の区切り文字まで、無ければ空文字） */
  readonly directoryPart: string;
  /** 入力済みパスのファイル名部分（最後の区切り文字以降、フィルタ・置換対象） */
  readonly namePart: string;
  /** namePart の開始列（行内、0始まり）。補完アイテムの置換範囲に使用 */
  readonly replaceStart: number;
}

/** include 文の途中（閉じ引用符前）を検出するパターン */
const INCLUDE_PREFIX_PATTERN = /\binclude\s+'([^']*)$/i;

/**
 * カーソル直前のテキストが include パス入力中かを判定し文脈を解決
 *
 * @remarks
 * 行コメント（;）内の include は対象外とする。`stripLineComment` は include の開始前に
 * 現れた `;` のみをコメント開始とみなすため、入力中のパス文字列内の文字は保持される。
 *
 * @param lineTextBeforeCursor - カーソル位置までの行テキスト
 * @returns include パス文脈、または include 入力中でない場合は undefined
 */
export function resolveIncludePathContext(
  lineTextBeforeCursor: string,
): IncludePathContext | undefined {
  // コメント内の include を除外（include 開始前の ; のみがコメント開始となる）
  const effective = stripLineComment(lineTextBeforeCursor);
  const match = INCLUDE_PREFIX_PATTERN.exec(effective);
  if (match === null) return undefined;

  const typed = match[1];
  // 最後の区切り文字でディレクトリ部とファイル名部に分割する
  const separatorIndex = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\'));
  const directoryPart = separatorIndex === -1 ? '' : typed.slice(0, separatorIndex + 1);
  const namePart = separatorIndex === -1 ? typed : typed.slice(separatorIndex + 1);

  // 行全体での typed 開始位置 = カーソル位置 - 入力済みパス長
  const typedStart = lineTextBeforeCursor.length - typed.length;
  const replaceStart = typedStart + (separatorIndex === -1 ? 0 : separatorIndex + 1);

  return { typed, directoryPart, namePart, replaceStart };
}

/** 類似パスとして採用する編集距離の上限（これを超える候補は除外） */
const MAX_SIMILARITY_DISTANCE = 5;

/**
 * 未検出 include パスに近い候補パスを順位付け
 *
 * @remarks
 * パス全体ではなくベース名（ファイル名）同士の編集距離で比較し、近い順に整列する。
 * 編集距離が上限を超える候補は除外する。
 *
 * @param target - 入力された（未検出の）include パス
 * @param candidates - 既存 `.ttl` の相対パス候補
 * @param limit - 返却する最大件数
 * @returns 類似度の高い順に並んだ候補パス
 */
export function rankSimilarPaths(
  target: string,
  candidates: readonly string[],
  limit: number,
): string[] {
  const targetBase = nodePath.basename(target).toLowerCase();

  return candidates
    .map(candidate => ({
      candidate,
      distance: levenshtein(targetBase, nodePath.basename(candidate).toLowerCase()),
    }))
    .filter(({ distance }) => distance <= MAX_SIMILARITY_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
