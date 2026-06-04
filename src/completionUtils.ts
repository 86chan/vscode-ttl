/**
 * 補完候補生成のためのVS Code非依存ユーティリティ
 *
 * @remarks
 * ドキュメント本文からのユーザー定義識別子抽出など、純粋関数のみを集約しテスト容易性を確保する。
 */

import {
  TTL_COMMANDS_MAP,
  TTL_STRUCTURAL_KEYWORDS,
  TTL_SYSTEM_VARIABLES,
} from './ttlData';

/** TTL識別子（ユーザー定義の変数名・ラベル名）のパターン */
export const TTL_IDENTIFIER_PATTERN = /[A-Za-z_]\w*/g;

/** 補完候補として提示する識別子の最小文字数（1文字のノイズを除外） */
const MIN_WORD_LENGTH = 2;

/**
 * 拡張機能が静的に提供する予約語の集合（小文字）
 *
 * @remarks ドキュメント由来の補完候補から組み込みコマンド・キーワード・システム変数の重複を除外するために使用
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set<string>([
  ...TTL_COMMANDS_MAP.keys(),
  ...TTL_STRUCTURAL_KEYWORDS,
  ...TTL_SYSTEM_VARIABLES,
]);

/**
 * ドキュメント本文からユーザー定義の識別子を抽出
 *
 * @remarks 予約語と最小文字数未満の語を除外し、重複を排除した集合を返す
 * @param text - ドキュメント全文
 * @returns 補完候補となる識別子の集合
 */
export function collectDocumentWords(text: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const match of text.matchAll(TTL_IDENTIFIER_PATTERN)) {
    const word = match[0];
    if (word.length >= MIN_WORD_LENGTH && !RESERVED_WORDS.has(word.toLowerCase())) {
      words.add(word);
    }
  }
  return words;
}
