/**
 * TTL コード整形ヘルパー関数のユニットテスト
 *
 * @remarks
 * VS Code API に依存しない純粋関数 formatTtl のみを対象とする。
 * プロバイダ全体の動作は Integration テストで検証する。
 */

import { describe, it, expect } from 'vitest';
import { formatTtl } from '../formatUtils';

describe('formatTtl', () => {
  it('if/then ブロックの本体をインデントする', () => {
    const input = ['if result <> 2 then', 'messagebox \'NG\' \'Error\'', 'endif'].join('\n');
    const expected = ['if result <> 2 then', '  messagebox \'NG\' \'Error\'', 'endif'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('for/next ブロックの本体をインデントする', () => {
    const input = ['for i 1 10', 'mpause 500', 'next'].join('\n');
    const expected = ['for i 1 10', '  mpause 500', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('while/endwhile ブロックの本体をインデントする', () => {
    const input = ['while result = 0', 'recvln', 'endwhile'].join('\n');
    const expected = ['while result = 0', '  recvln', 'endwhile'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('ネストしたブロックを多段インデントする', () => {
    const input = [
      'for i 1 10',
      'if result = 0 then',
      'break',
      'endif',
      'next',
    ].join('\n');
    const expected = [
      'for i 1 10',
      '  if result = 0 then',
      '    break',
      '  endif',
      'next',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('else / elseif で本体をインデントし分岐行自体は浅くする', () => {
    const input = [
      'if a = 1 then',
      'sendln \'one\'',
      'elseif a = 2 then',
      'sendln \'two\'',
      'else',
      'sendln \'other\'',
      'endif',
    ].join('\n');
    const expected = [
      'if a = 1 then',
      '  sendln \'one\'',
      'elseif a = 2 then',
      '  sendln \'two\'',
      'else',
      '  sendln \'other\'',
      'endif',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('then の後にコマンドが続く単一行 if はブロックを開かない', () => {
    const input = ['if result = 0 then break', 'sendln \'next\''].join('\n');
    const expected = ['if result = 0 then break', 'sendln \'next\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('ラベル定義行は常にインデント0に揃える', () => {
    const input = ['for i 1 10', '  :inner', 'next'].join('\n');
    const expected = ['for i 1 10', ':inner', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('空行は末尾空白なしの空行として保持する', () => {
    const input = ['for i 1 10', '   ', 'mpause 1', 'next'].join('\n');
    const expected = ['for i 1 10', '', '  mpause 1', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('文字列内のキーワードはネスト計算に影響しない', () => {
    const input = ['sendln \'for next endif\'', 'wait \'$\''].join('\n');
    const expected = ['sendln \'for next endif\'', 'wait \'$\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('コメント内のキーワードはネスト計算に影響しない', () => {
    const input = ['wait \'$\' ; if then endif', 'sendln \'ok\''].join('\n');
    const expected = ['wait \'$\' ; if then endif', 'sendln \'ok\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('既存の誤ったインデントを正しく再計算する', () => {
    const input = ['      for i 1 10', 'mpause 1', '          next'].join('\n');
    const expected = ['for i 1 10', '  mpause 1', 'next'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('閉じキーワードが過剰でもインデントは負にならない', () => {
    const input = ['endif', 'sendln \'ok\''].join('\n');
    const expected = ['endif', 'sendln \'ok\''].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('indentUnit オプションでインデント文字を切り替えられる', () => {
    const input = ['for i 1 10', 'mpause 1', 'next'].join('\n');
    const expected = ['for i 1 10', '\tmpause 1', 'next'].join('\n');
    expect(formatTtl(input, { indentUnit: '\t' })).toBe(expected);
  });

  it('CRLF 改行を保持する', () => {
    const input = ['for i 1 10', 'mpause 1', 'next'].join('\r\n');
    const expected = ['for i 1 10', '  mpause 1', 'next'].join('\r\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('do/loop ブロックの本体をインデントする', () => {
    const input = ['do', 'recvln', 'loop'].join('\n');
    const expected = ['do', '  recvln', 'loop'].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('コメント内の markdown テーブルを桁揃えする（全角文字対応）', () => {
    const input = [
      '; ===============================',
      '; 関数名',
      '; ',
      '; - 必須変数',
      '; | 変数名 | R/W | 概要 |',
      '; | --- | --- | --- |',
      '; | name | R | 名前 |',
      '; | age | R | 年齢 |',
      '; | since | W | 生まれ |',
      '; ',
      '; ===============================',
    ].join('\n');
    const expected = [
      '; ===============================',
      '; 関数名',
      ';',
      '; - 必須変数',
      '; | 変数名 | R/W | 概要   |',
      '; | ------ | --- | ------ |',
      '; | name   | R   | 名前   |',
      '; | age    | R   | 年齢   |',
      '; | since  | W   | 生まれ |',
      ';',
      '; ===============================',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('崩れたコメントテーブルの桁を揃え直す', () => {
    const input = [
      ';|a|bb|',
      ';|---|---|',
      ';|1|22|',
    ].join('\n');
    const expected = [
      '; | a   | bb  |',
      '; | --- | --- |',
      '; | 1   | 22  |',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('列揃え指定（:--- / ---: / :---:）を保持する', () => {
    const input = [
      '; | left | center | right |',
      '; | :--- | :---: | ---: |',
      '; | a | b | c |',
    ].join('\n');
    const expected = [
      '; | left | center | right |',
      '; | :--- | :----: | ----: |',
      '; | a    |   b    |     c |',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('区切り行のないテーブルもどきは変更しない', () => {
    const input = ['; | a | b |', '; | c | d |'].join('\n');
    expect(formatTtl(input)).toBe(input);
  });

  it('インデントされたブロック内のコメントテーブルも桁揃えする', () => {
    const input = [
      'for i 1 3',
      '; | k | v |',
      '; | --- | --- |',
      '; | a | 1 |',
      'next',
    ].join('\n');
    const expected = [
      'for i 1 3',
      '  ; | k   | v   |',
      '  ; | --- | --- |',
      '  ; | a   | 1   |',
      'next',
    ].join('\n');
    expect(formatTtl(input)).toBe(expected);
  });

  it('コメントテーブルを含んでも CRLF を保持する', () => {
    const input = ['; | a | b |', '; | --- | --- |', '; | 1 | 2 |'].join('\r\n');
    const expected = ['; | a   | b   |', '; | --- | --- |', '; | 1   | 2   |'].join('\r\n');
    expect(formatTtl(input)).toBe(expected);
  });

  describe('演算子・カンマの空白正規化', () => {
    it('代入演算子の両側に空白を付与する', () => {
      // Arrange: 空白の無い代入文
      const input = 'a=1';
      // Act & Assert: 代入演算子の前後に半角スペースが入る
      expect(formatTtl(input)).toBe('a = 1');
    });

    it('比較演算子（==）の両側に空白を付与する', () => {
      const input = 'if a==1 then\nb=2\nendif';
      const expected = ['if a == 1 then', '  b = 2', 'endif'].join('\n');
      expect(formatTtl(input)).toBe(expected);
    });

    it('複数文字の比較演算子（<> <= >=）を正しく扱う', () => {
      const input = 'if x<>0 then\nif y<=1 then\nif z>=2 then\nbreak\nendif\nendif\nendif';
      const expected = [
        'if x <> 0 then',
        '  if y <= 1 then',
        '    if z >= 2 then',
        '      break',
        '    endif',
        '  endif',
        'endif',
      ].join('\n');
      expect(formatTtl(input)).toBe(expected);
    });

    it('二項算術演算子の両側に空白を付与する', () => {
      // Arrange: 被演算子に隣接した二項演算
      const input = 'a=a+1*b';
      // Act & Assert: 二項演算子の両側に空白が入る
      expect(formatTtl(input)).toBe('a = a + 1 * b');
    });

    it('単項マイナス（負数リテラル）は変更しない', () => {
      // Arrange: 代入された負数
      const input = 'a=-1';
      // Act & Assert: マイナスは演算子化されず負数のまま
      expect(formatTtl(input)).toBe('a = -1');
    });

    it('空白で離れたコマンド引数の負数は変更しない', () => {
      // Arrange: コマンドと負数引数（離れている）
      const input = 'mpause -1';
      // Act & Assert: 二項演算子化されない
      expect(formatTtl(input)).toBe('mpause -1');
    });

    it('カンマは前空白なし・後ろ空白1つに統一する', () => {
      const input = 'strsplit str ,b ,  c';
      expect(formatTtl(input)).toBe('strsplit str, b, c');
    });

    it('文字列リテラル内の演算子は変更しない', () => {
      const input = "sendln 'a=1,b<>2'";
      expect(formatTtl(input)).toBe("sendln 'a=1,b<>2'");
    });

    it('行末コメント内の演算子は変更せずコードのみ整形する', () => {
      const input = 'a=1 ; b=2 は比較ではない';
      expect(formatTtl(input)).toBe('a = 1 ; b=2 は比較ではない');
    });

    it('複数の空白を1つに圧縮する', () => {
      const input = 'mpause   500';
      expect(formatTtl(input)).toBe('mpause 500');
    });

    it('複合代入や ++ は誤変換しない（既存の負数同様に保護）', () => {
      // Arrange: TTL では無効だが誤って分解されないことを確認
      const input = 'a+=1';
      // Act & Assert: += を ' + = ' のように壊さない
      expect(formatTtl(input)).toBe('a+=1');
    });

    it('normalizeOperatorSpacing を無効にすると空白を変更しない', () => {
      const input = 'a=1';
      expect(formatTtl(input, { normalizeOperatorSpacing: false })).toBe('a=1');
    });
  });

  describe('連続空行の圧縮', () => {
    it('既定では連続空行を1行に圧縮する', () => {
      const input = ['sendln \'a\'', '', '', '', 'sendln \'b\''].join('\n');
      const expected = ['sendln \'a\'', '', 'sendln \'b\''].join('\n');
      expect(formatTtl(input)).toBe(expected);
    });

    it('maxConsecutiveBlankLines で許容行数を指定できる', () => {
      const input = ['sendln \'a\'', '', '', '', 'sendln \'b\''].join('\n');
      const expected = ['sendln \'a\'', '', '', 'sendln \'b\''].join('\n');
      expect(formatTtl(input, { maxConsecutiveBlankLines: 2 })).toBe(expected);
    });

    it('maxConsecutiveBlankLines が 0 なら空行を圧縮しない', () => {
      const input = ['sendln \'a\'', '', '', 'sendln \'b\''].join('\n');
      expect(formatTtl(input, { maxConsecutiveBlankLines: 0 })).toBe(input);
    });
  });

  describe('オプションのトグル', () => {
    it('alignCommentTables を無効にするとテーブルを桁揃えしない', () => {
      const input = ['; | a | b |', '; | --- | --- |', '; | 1 | 2 |'].join('\n');
      expect(formatTtl(input, { alignCommentTables: false })).toBe(input);
    });
  });
});
