/**
 * 補完ユーティリティのユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 `collectDocumentWords` を対象とする。
 * プロバイダ全体の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import { collectDocumentWords } from '../completionUtils';

describe('collectDocumentWords', () => {
  it('ユーザーが定義した変数名を候補として抽出すること', () => {
    // Arrange: 変数 myVar と loopCount を含むスクリプト
    const source = [
      "sprintf2 myVar 'value'",
      'for loopCount 1 10',
      'next',
    ].join('\n');

    // Act
    const words = collectDocumentWords(source);

    // Assert: ユーザー定義の識別子が含まれる
    expect(words.has('myVar')).toBe(true);
    expect(words.has('loopCount')).toBe(true);
  });

  it('組み込みコマンド・キーワード・システム変数を予約語として除外すること', () => {
    // Arrange: コマンド(sprintf2)・キーワード(for/next)・システム変数(result)のみ
    const source = [
      "sprintf2 buffer 'x'",
      'for index 1 5',
      'next',
      'if result = 0 then',
      'endif',
    ].join('\n');

    // Act
    const words = collectDocumentWords(source);

    // Assert: 予約語は候補に含まれない
    expect(words.has('sprintf2')).toBe(false);
    expect(words.has('for')).toBe(false);
    expect(words.has('next')).toBe(false);
    expect(words.has('result')).toBe(false);
    // ユーザー定義の識別子は残る
    expect(words.has('buffer')).toBe(true);
    expect(words.has('index')).toBe(true);
  });

  it('予約語の大文字小文字を区別せず除外すること', () => {
    // Arrange: コマンドを大文字で記述（TTL は大文字小文字を区別しない）
    const source = "MessageBox 'hello' 'title'";

    // Act
    const words = collectDocumentWords(source);

    // Assert: 大文字表記でも予約語として除外される
    expect(words.has('MessageBox')).toBe(false);
  });

  it('1文字の識別子をノイズとして除外すること', () => {
    // Arrange: 1文字変数 i と 2文字以上の識別子
    const source = ['for i 1 10', 'next', "sendln cmdLine"].join('\n');

    // Act
    const words = collectDocumentWords(source);

    // Assert
    expect(words.has('i')).toBe(false);
    expect(words.has('cmdLine')).toBe(true);
  });

  it('重複する識別子を一意化すること', () => {
    // Arrange: 同じ変数 counter が複数回出現
    const source = [
      'counter = 0',
      'counter = counter + 1',
    ].join('\n');

    // Act
    const words = collectDocumentWords(source);
    const occurrences = [...words].filter(word => word === 'counter');

    // Assert: Set による一意化で 1 件のみ
    expect(occurrences).toHaveLength(1);
  });
});
