/**
 * include パス解析ユーティリティのユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 `resolveIncludePathContext` / `rankSimilarPaths` を対象とする。
 * プロバイダ全体（FS 読み取り・補完アイテム生成）の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import { rankSimilarPaths, resolveIncludePathContext } from '../includePathUtils';

describe('resolveIncludePathContext', () => {
  it('include の開き引用符直後で空のパス文脈を返すこと', () => {
    // Arrange: include の引用符を開いた直後にカーソルがある状態
    const lineBeforeCursor = "include '";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert: typed/directoryPart/namePart は空、置換開始は引用符の次の桁
    expect(context).toEqual({
      typed: '',
      directoryPart: '',
      namePart: '',
      replaceStart: lineBeforeCursor.length,
    });
  });

  it('ファイル名入力途中で namePart と置換開始位置を返すこと', () => {
    // Arrange: ディレクトリ無しでファイル名を途中まで入力した状態
    const lineBeforeCursor = "include 'hel";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert: namePart は入力済みファイル名、置換開始はその先頭
    expect(context?.typed).toBe('hel');
    expect(context?.directoryPart).toBe('');
    expect(context?.namePart).toBe('hel');
    expect(context?.replaceStart).toBe("include '".length);
  });

  it('サブディレクトリ入力後はディレクトリ部とファイル名部を分割すること', () => {
    // Arrange: サブディレクトリ配下のファイル名を入力途中の状態
    const lineBeforeCursor = "include 'sub/child";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert: ディレクトリ部は区切り文字まで、置換対象は最後のファイル名部分のみ
    expect(context?.directoryPart).toBe('sub/');
    expect(context?.namePart).toBe('child');
    expect(context?.replaceStart).toBe("include 'sub/".length);
  });

  it('Windows 形式のバックスラッシュ区切りも分割対象とすること', () => {
    // Arrange: バックスラッシュ区切りのパスを入力した状態
    const lineBeforeCursor = "include 'sub\\child";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert: バックスラッシュも区切りとして扱われる
    expect(context?.directoryPart).toBe('sub\\');
    expect(context?.namePart).toBe('child');
  });

  it('閉じ引用符の後ではパス文脈を返さないこと', () => {
    // Arrange: include 文字列が既に閉じられている状態
    const lineBeforeCursor = "include 'done.ttl' ";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert: 入力中ではないため undefined
    expect(context).toBeUndefined();
  });

  it('行コメント（;）内の include は対象外とすること', () => {
    // Arrange: include が ; 以降のコメント内にある状態
    const lineBeforeCursor = "; include 'sub/";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert: コメント内は補完対象外
    expect(context).toBeUndefined();
  });

  it('include 文でない行では undefined を返すこと', () => {
    // Arrange: include を含まない通常行
    const lineBeforeCursor = "connect 'host'";

    // Act
    const context = resolveIncludePathContext(lineBeforeCursor);

    // Assert
    expect(context).toBeUndefined();
  });
});

describe('rankSimilarPaths', () => {
  it('ベース名が近い候補を距離の昇順で返すこと', () => {
    // Arrange: タイプミスした target と、類似度の異なる候補群
    const target = 'helpr.ttl';
    const candidates = ['sub/helper.ttl', 'main.ttl', 'helpers.ttl'];

    // Act
    const ranked = rankSimilarPaths(target, candidates, 3);

    // Assert: ベース名の編集距離が小さい順（helper=1, helpers=2）に並び、無関係は末尾/除外
    expect(ranked[0]).toBe('sub/helper.ttl');
    expect(ranked).toContain('helpers.ttl');
  });

  it('limit を超える候補は切り捨てること', () => {
    // Arrange: 似た候補が複数ある状態
    const candidates = ['a.ttl', 'ab.ttl', 'abc.ttl', 'abcd.ttl'];

    // Act
    const ranked = rankSimilarPaths('a.ttl', candidates, 2);

    // Assert: 上位 2 件のみ返る
    expect(ranked).toHaveLength(2);
  });

  it('編集距離が上限を超える候補は除外すること', () => {
    // Arrange: target と全く異なる候補のみ
    const candidates = ['completely_different_name.ttl'];

    // Act
    const ranked = rankSimilarPaths('x.ttl', candidates, 3);

    // Assert: 閾値超過のため候補なし
    expect(ranked).toEqual([]);
  });
});
