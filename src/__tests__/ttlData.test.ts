/**
 * TTLデータ定義の静的整合性テスト
 *
 * @remarks
 * - `ttlData.ts` はVSCode APIに依存しないため、Vitestで直接テスト可能。
 * - コマンドの重複・説明欠落・マップ整合性・文法パターン適用範囲を検証する。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  TTL_COMMANDS,
  TTL_COMMANDS_MAP,
  TTL_STRUCTURAL_KEYWORDS,
  TTL_SYSTEM_VARIABLES,
} from '../ttlData';

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/** TextMate文法ファイルを読み込んで返す */
function loadGrammar(): {
  repository: Record<string, { match: string; begin?: string }>;
} {
  const grammarPath = resolve(__dirname, '../../syntaxes/ttl.tmLanguage.json');
  return JSON.parse(readFileSync(grammarPath, 'utf8')) as ReturnType<typeof loadGrammar>;
}

/** 正規表現パターンが対象文字列を単語境界込みでマッチするか検証 */
function matchesAsWholeWord(pattern: string, word: string): boolean {
  // (?i) フラグを除去して RegExp に変換
  const cleanPattern = pattern.replace(/^\(\?i\)/, '');
  const regex = new RegExp(cleanPattern, 'i');
  return regex.test(word);
}

// ── TTL_COMMANDS テスト ───────────────────────────────────────────────────────

describe('TTL_COMMANDS', () => {
  it('コマンド名に重複がない', () => {
    const names = TTL_COMMANDS.map(c => c.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });

  it('全コマンドが英語説明を持つ', () => {
    const missing = TTL_COMMANDS.filter(c => c.description.trim() === '');
    expect(missing.map(c => c.name)).toEqual([]);
  });

  it('全コマンドが日本語説明を持つ', () => {
    const missing = TTL_COMMANDS.filter(
      c => c.descriptionJa === undefined || c.descriptionJa.trim() === ''
    );
    expect(missing.map(c => c.name)).toEqual([]);
  });

  it('全コマンドがシグネチャを持つ', () => {
    const missing = TTL_COMMANDS.filter(c => c.signature.trim() === '');
    expect(missing.map(c => c.name)).toEqual([]);
  });

  it('コマンド名がすべて小文字', () => {
    const upperCase = TTL_COMMANDS.filter(c => c.name !== c.name.toLowerCase());
    expect(upperCase.map(c => c.name)).toEqual([]);
  });

  it('スニペットに ${ が含まれる場合は有効なスニペット構文', () => {
    // ${ が含まれる場合、${N:placeholder} 形式であること
    const invalidSnippets = TTL_COMMANDS.filter(c => {
      if (c.snippet === undefined) return false;
      return c.snippet.includes('${') && !/\$\{\d+[:|/}]/.test(c.snippet);
    });
    expect(invalidSnippets.map(c => c.name)).toEqual([]);
  });

  it('コマンド数が妥当な範囲 (100〜300件)', () => {
    expect(TTL_COMMANDS.length).toBeGreaterThanOrEqual(100);
    expect(TTL_COMMANDS.length).toBeLessThanOrEqual(300);
  });
});

// ── TTL_COMMANDS_MAP テスト ───────────────────────────────────────────────────

describe('TTL_COMMANDS_MAP', () => {
  it('TTL_COMMANDS と同じ件数', () => {
    expect(TTL_COMMANDS_MAP.size).toBe(TTL_COMMANDS.length);
  });

  it('キーがコマンド名と一致する', () => {
    for (const [key, command] of TTL_COMMANDS_MAP) {
      expect(key).toBe(command.name.toLowerCase());
    }
  });

  it('代表的なコマンドが引ける', () => {
    expect(TTL_COMMANDS_MAP.has('sendln')).toBe(true);
    expect(TTL_COMMANDS_MAP.has('connect')).toBe(true);
    expect(TTL_COMMANDS_MAP.has('wait')).toBe(true);
    expect(TTL_COMMANDS_MAP.has('messagebox')).toBe(true);
    expect(TTL_COMMANDS_MAP.has('fileopen')).toBe(true);
  });

  it('大文字キーは引けない（マップは小文字のみ）', () => {
    expect(TTL_COMMANDS_MAP.has('Sendln')).toBe(false);
    expect(TTL_COMMANDS_MAP.has('CONNECT')).toBe(false);
  });

  it('sendln のシグネチャが正しい形式', () => {
    const sendln = TTL_COMMANDS_MAP.get('sendln');
    expect(sendln?.signature).toMatch(/sendln/i);
  });
});

// ── TTL_STRUCTURAL_KEYWORDS テスト ───────────────────────────────────────────

describe('TTL_STRUCTURAL_KEYWORDS', () => {
  it('重複がない', () => {
    const duplicates = TTL_STRUCTURAL_KEYWORDS.filter(
      (kw, i) => TTL_STRUCTURAL_KEYWORDS.indexOf(kw) !== i
    );
    expect(duplicates).toEqual([]);
  });

  it('制御フロー必須キーワードが含まれる', () => {
    const required = ['if', 'for', 'while', 'do', 'goto', 'call', 'return', 'end', 'break'];
    for (const kw of required) {
      expect(TTL_STRUCTURAL_KEYWORDS).toContain(kw);
    }
  });

  it('全て小文字', () => {
    const upperCase = TTL_STRUCTURAL_KEYWORDS.filter(kw => kw !== kw.toLowerCase());
    expect(upperCase).toEqual([]);
  });
});

// ── TTL_SYSTEM_VARIABLES テスト ──────────────────────────────────────────────

describe('TTL_SYSTEM_VARIABLES', () => {
  it('重複がない', () => {
    const duplicates = TTL_SYSTEM_VARIABLES.filter(
      (v, i) => TTL_SYSTEM_VARIABLES.indexOf(v) !== i
    );
    expect(duplicates).toEqual([]);
  });

  it('必須システム変数が含まれる', () => {
    const required = ['result', 'inputstr', 'matchstr', 'timeout', 'paramcnt'];
    for (const v of required) {
      expect(TTL_SYSTEM_VARIABLES).toContain(v);
    }
  });

  it('groupmatchstr1〜9 が全て含まれる', () => {
    for (let i = 1; i <= 9; i++) {
      expect(TTL_SYSTEM_VARIABLES).toContain(`groupmatchstr${i}`);
    }
  });

  it('param1〜9 が全て含まれる', () => {
    for (let i = 1; i <= 9; i++) {
      expect(TTL_SYSTEM_VARIABLES).toContain(`param${i}`);
    }
  });
});

// ── TextMate 文法テスト ───────────────────────────────────────────────────────

describe('TextMate grammar', () => {
  const grammar = loadGrammar();
  const commandsPattern = grammar.repository['commands'].match;
  const keywordsPattern = grammar.repository['keywords-control'].match;

  it('代表的なコマンドが commands パターンにマッチする', () => {
    const samples = ['sendln', 'connect', 'wait', 'messagebox', 'fileopen',
                     'sprintf', 'strcompare', 'getdate', 'logopen'];
    for (const cmd of samples) {
      expect(matchesAsWholeWord(commandsPattern, cmd), `"${cmd}" should match commands pattern`).toBe(true);
    }
  });

  it('checksum/crc の変形が commands パターンにマッチする', () => {
    const variants = ['checksum8', 'checksum16', 'checksum32',
                      'checksum8file', 'checksum16file', 'checksum32file',
                      'crc16', 'crc32', 'crc16file', 'crc32file'];
    for (const cmd of variants) {
      expect(matchesAsWholeWord(commandsPattern, cmd), `"${cmd}" should match`).toBe(true);
    }
  });

  it('制御フローキーワードが keywords-control パターンにマッチする', () => {
    const kwSamples = ['if', 'then', 'else', 'elseif', 'endif',
                       'for', 'next', 'while', 'endwhile',
                       'do', 'loop', 'until', 'enduntil',
                       'break', 'continue', 'call', 'return', 'goto'];
    for (const kw of kwSamples) {
      expect(matchesAsWholeWord(keywordsPattern, kw), `"${kw}" should match keywords pattern`).toBe(true);
    }
  });

  it('変数名が commands/keywords パターンにマッチしない', () => {
    // TTL変数名はコマンドとして解釈されてはならない
    const variables = ['myvar', 'counter', 'hostname', 'filepath'];
    for (const v of variables) {
      expect(matchesAsWholeWord(commandsPattern, v), `"${v}" should NOT match commands`).toBe(false);
      expect(matchesAsWholeWord(keywordsPattern, v), `"${v}" should NOT match keywords`).toBe(false);
    }
  });

  it('論理演算子が keywords-operator パターンにマッチする', () => {
    const operatorPattern = grammar.repository['keywords-operator'].match;
    for (const op of ['and', 'or', 'xor', 'not']) {
      expect(matchesAsWholeWord(operatorPattern, op), `"${op}" should match`).toBe(true);
    }
  });

  it('文字列パターンの begin/end が定義されている', () => {
    const stringRepo = grammar.repository['strings'] as { begin: string; end: string };
    expect(stringRepo.begin).toBe("'");
    expect(stringRepo.end).toMatch(/'/);
  });
});

// ── セキュリティ検証 ──────────────────────────────────────────────────────────

describe('セキュリティ', () => {
  it('extension.ts が isTrusted = true を設定していない', () => {
    // isTrusted = true は command: URI 経由でのコマンド実行を許可するため禁止
    const extensionPath = resolve(__dirname, '../../src/extension.ts');
    const source = readFileSync(extensionPath, 'utf8');
    expect(source).not.toMatch(/isTrusted\s*=\s*true/);
  });

  it('コマンド説明文に command: URI が含まれない', () => {
    // command: URI はホバー表示からコマンドを実行できるため禁止
    const hasCommandUri = TTL_COMMANDS.some(
      c =>
        c.description.includes('command:') ||
        (c.descriptionJa?.includes('command:') ?? false),
    );
    expect(hasCommandUri).toBe(false);
  });

  it('コマンド説明文に <script> タグが含まれない', () => {
    const hasScript = TTL_COMMANDS.some(
      c =>
        /<script/i.test(c.description) ||
        (c.descriptionJa !== undefined && /<script/i.test(c.descriptionJa)),
    );
    expect(hasScript).toBe(false);
  });

  it('extension.ts のソースに eval() 呼び出しが含まれない', () => {
    // スニペット文字列ではなく、拡張機能のランタイムコード自体が eval を使わないことを保証する
    const extensionPath = resolve(__dirname, '../../src/extension.ts');
    const source = readFileSync(extensionPath, 'utf8');
    // eval() または new Function() によるコード実行を禁止
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
  });
});
