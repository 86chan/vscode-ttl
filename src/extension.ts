/**
 * TTL (Tera Term Language) VS Code 拡張機能のエントリポイント
 */

import * as childProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { collectDocumentWords, TTL_IDENTIFIER_PATTERN } from './completionUtils';
import { analyzeTtl, DEFAULT_MAX_NESTING_DEPTH, type TtlDiagnostic } from './diagnosticsUtils';
import {
  buildConnectArgs,
  buildTeraTermLaunch,
  buildTeraTermOptions,
  buildTtlConnectString,
  buildTtpMacroLaunch,
  DEFAULT_TERATERM_DIRS,
  resolveTeraTermDir,
  type TeraTermOptions,
  type TtlConnect,
} from './macroRunner';
import { type FormatOptions, formatTtl } from './formatUtils';
import { extractLabelDefinition, extractLabelReferences } from './labelUtils';
import {
  collectLabelOccurrences,
  extractDocumentSymbols,
  extractIncludeDirectives,
  type TtlSymbol,
} from './navigationUtils';
import {
  type TtlCommand,
  TTL_COMMANDS_MAP,
  TTL_STRUCTURAL_KEYWORDS,
  TTL_SYSTEM_VARIABLES,
} from './ttlData';

const TTL_LANGUAGE_ID = 'ttl' as const;

/** ラベル参照行のパターン（goto/call の引数） */
const LABEL_REFERENCE_PREFIX = /(?:goto|call)\s+$/i;

/**
 * 設定または VS Code UI 言語から表示言語を解決
 *
 * @returns 表示言語識別子
 */
function resolveDisplayLanguage(): 'ja' | 'en' {
  const setting = vscode.workspace.getConfiguration('ttl').get<string>('language', 'auto');
  if (setting === 'ja') return 'ja';
  if (setting === 'en') return 'en';
  return vscode.env.language.startsWith('ja') ? 'ja' : 'en';
}

/**
 * コマンドの説明文を表示言語に応じて選択
 *
 * @param command - TTLコマンド定義
 * @param language - 表示言語
 * @returns 選択された説明文
 */
function selectDescription(command: TtlCommand, language: 'ja' | 'en'): string {
  if (language === 'ja' && command.descriptionJa !== undefined) {
    return command.descriptionJa;
  }
  return command.description;
}

/**
 * コマンドのホバーテキストを生成
 *
 * @param command - TTLコマンド定義
 * @param language - 表示言語
 * @returns Markdown 形式のホバーコンテンツ
 */
function buildHoverMarkdown(command: TtlCommand, language: 'ja' | 'en'): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  // isTrusted は明示的に false のまま（command: URI によるコマンド実行を許可しない）
  markdown.appendCodeblock(command.signature, 'ttl');
  markdown.appendMarkdown(selectDescription(command, language));
  return markdown;
}

/**
 * 起点ドキュメントから include を辿り、ラベル定義を最初に見つけた位置を返す
 *
 * @remarks
 * 起点ドキュメント自身を先頭に幅優先探索する。これにより同一ファイル内の定義が
 * 優先され、見つからない場合のみ include 先（再帰的に）を探索する。
 *
 * @param startUri - 探索の起点となるドキュメントの URI
 * @param startText - 起点ドキュメントの全文
 * @param labelName - 探索するラベル名（小文字）
 * @returns ラベル定義の位置、または見つからない場合は undefined
 */
async function findLabelDefinitionAcrossFiles(
  startUri: vscode.Uri,
  startText: string,
  labelName: string,
): Promise<vscode.Location | undefined> {
  const visited = new Set<string>();
  const queue: Array<{ readonly uri: vscode.Uri; readonly text: string }> = [
    { uri: startUri, text: startText },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (visited.has(current.uri.fsPath)) continue;
    visited.add(current.uri.fsPath);

    const definition = collectLabelOccurrences(current.text, labelName).find(
      occurrence => occurrence.isDefinition,
    );
    if (definition !== undefined) {
      return new vscode.Location(
        current.uri,
        new vscode.Position(definition.line, definition.startCharacter),
      );
    }

    const fileDir = nodePath.dirname(current.uri.fsPath);
    for (const include of extractIncludeDirectives(current.text)) {
      const includedAbsolute = nodePath.resolve(fileDir, include.path);
      if (visited.has(includedAbsolute)) continue;
      try {
        const includedUri = vscode.Uri.file(includedAbsolute);
        const includedDocument = await vscode.workspace.openTextDocument(includedUri);
        queue.push({ uri: includedUri, text: includedDocument.getText() });
      } catch {
        // include 先を開けない場合（存在しない等）は無視して探索を続ける
      }
    }
  }

  return undefined;
}

/**
 * TTL 補完プロバイダ
 *
 * @remarks コマンド・キーワード・システム変数の補完候補を提供
 */
class TtlCompletionProvider implements vscode.CompletionItemProvider {
  /**
   * 補完候補一覧の提供
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @returns 補完候補の配列
   */
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const language = resolveDisplayLanguage();
    const commandItems = this.buildCommandItems(language);
    const keywordItems = this.buildKeywordItems();
    const variableItems = this.buildVariableItems();
    const documentWordItems = this.buildDocumentWordItems(document, position);
    return [...commandItems, ...keywordItems, ...variableItems, ...documentWordItems];
  }

  private buildCommandItems(language: 'ja' | 'en'): vscode.CompletionItem[] {
    return [...TTL_COMMANDS_MAP.values()].map(command => {
      const item = new vscode.CompletionItem(command.name, vscode.CompletionItemKind.Function);
      item.detail = command.signature;
      item.documentation = new vscode.MarkdownString(selectDescription(command, language));
      if (command.snippet !== undefined) {
        item.insertText = new vscode.SnippetString(command.snippet);
      }
      return item;
    });
  }

  private buildKeywordItems(): vscode.CompletionItem[] {
    // コマンドマップに既に含まれているキーワードは除外して重複を防ぐ
    return TTL_STRUCTURAL_KEYWORDS
      .filter(keyword => !TTL_COMMANDS_MAP.has(keyword))
      .map(keyword => new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword));
  }

  private buildVariableItems(): vscode.CompletionItem[] {
    return TTL_SYSTEM_VARIABLES.map(variable => {
      const item = new vscode.CompletionItem(variable, vscode.CompletionItemKind.Variable);
      item.detail = 'System variable';
      return item;
    });
  }

  /**
   * ドキュメント内のユーザー定義識別子から補完候補を生成
   *
   * @remarks エディタ標準の単語ベース補完に依存せず、過去に入力した変数名・ラベル名を確実に候補化
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @returns 入力中の語を除いた識別子の補完候補
   */
  private buildDocumentWordItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const words = collectDocumentWords(document.getText());

    // 入力中の語そのものを候補から除外する
    const currentWordRange = document.getWordRangeAtPosition(position, TTL_IDENTIFIER_PATTERN);
    const currentWord = currentWordRange !== undefined
      ? document.getText(currentWordRange)
      : undefined;

    const items: vscode.CompletionItem[] = [];
    for (const word of words) {
      if (word === currentWord) continue;
      const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Text);
      item.detail = 'User-defined identifier';
      items.push(item);
    }
    return items;
  }
}

/**
 * TTL ホバープロバイダ
 *
 * @remarks コマンド上でカーソルを置いたときのドキュメントを提供
 */
class TtlHoverProvider implements vscode.HoverProvider {
  /**
   * ホバー情報の提供
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @returns ホバー情報、またはコマンドが見つからない場合は undefined
   */
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(position, /\w+/);
    if (range === undefined) return undefined;

    const word = document.getText(range).toLowerCase();
    const command = TTL_COMMANDS_MAP.get(word);
    if (command === undefined) return undefined;

    return new vscode.Hover(buildHoverMarkdown(command, resolveDisplayLanguage()), range);
  }
}

/**
 * TTL 定義ジャンププロバイダ
 *
 * @remarks
 * goto/call コマンドのラベル参照から定義へジャンプできるようにする。
 * 同一ファイル内に定義がない場合は include 先（再帰的に）も探索する。
 */
class TtlDefinitionProvider implements vscode.DefinitionProvider {
  /**
   * 定義位置の提供
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @returns ラベル定義の位置、または見つからない場合は undefined
   */
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location | undefined> | undefined {
    const range = document.getWordRangeAtPosition(position, /\w+/);
    if (range === undefined) return undefined;

    const lineText = document.lineAt(position.line).text;
    const textBeforeWord = lineText.substring(0, range.start.character);

    if (!LABEL_REFERENCE_PREFIX.test(textBeforeWord)) return undefined;

    const labelName = document.getText(range).toLowerCase();
    return findLabelDefinitionAcrossFiles(document.uri, document.getText(), labelName);
  }
}

/**
 * TTL 参照検索プロバイダ
 *
 * @remarks ラベル定義・参照のいずれかにカーソルを置くと、定義（:label）と
 * 全ての参照（goto/call）の一覧を提供する（Shift+F12）
 */
class TtlReferenceProvider implements vscode.ReferenceProvider {
  /**
   * 参照一覧の提供
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @param context - 定義自身を含めるかどうかの情報
   * @returns ラベルの出現箇所の Location 配列、またはラベル位置でない場合は undefined
   */
  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
  ): vscode.Location[] | undefined {
    const range = resolveLabelNameRange(document, position);
    if (range === undefined) return undefined;

    const labelName = document.getText(range).toLowerCase();
    return collectLabelOccurrences(document.getText(), labelName)
      .filter(occurrence => context.includeDeclaration || !occurrence.isDefinition)
      .map(
        occurrence =>
          new vscode.Location(
            document.uri,
            new vscode.Range(
              new vscode.Position(occurrence.line, occurrence.startCharacter),
              new vscode.Position(occurrence.line, occurrence.endCharacter),
            ),
          ),
      );
  }
}

/**
 * TTL ドキュメントシンボルプロバイダ
 *
 * @remarks ラベル定義と include をアウトライン・パンくず・シンボル検索に提供する
 */
class TtlDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  /**
   * ドキュメントシンボル一覧の提供
   *
   * @param document - 対象ドキュメント
   * @returns ラベル・include のシンボル配列
   */
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    return extractDocumentSymbols(document.getText()).map(symbol =>
      this.toDocumentSymbol(symbol),
    );
  }

  private toDocumentSymbol(symbol: TtlSymbol): vscode.DocumentSymbol {
    const range = new vscode.Range(
      new vscode.Position(symbol.line, symbol.startCharacter),
      new vscode.Position(symbol.line, symbol.endCharacter),
    );
    const isLabel = symbol.kind === 'label';
    return new vscode.DocumentSymbol(
      isLabel ? `:${symbol.name}` : symbol.name,
      isLabel ? '' : 'include',
      isLabel ? vscode.SymbolKind.Function : vscode.SymbolKind.File,
      range,
      range,
    );
  }
}

/**
 * TTL ドキュメントリンクプロバイダ
 *
 * @remarks include 'path' のパス部分を Ctrl+クリックで開けるリンクにする
 */
class TtlDocumentLinkProvider implements vscode.DocumentLinkProvider {
  /**
   * ドキュメントリンク一覧の提供
   *
   * @param document - 対象ドキュメント
   * @returns include パスへのリンク配列
   */
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const fileDir = nodePath.dirname(document.uri.fsPath);
    return extractIncludeDirectives(document.getText()).map(include => {
      const range = new vscode.Range(
        new vscode.Position(include.line, include.startCharacter),
        new vscode.Position(include.line, include.endCharacter),
      );
      const target = vscode.Uri.file(nodePath.resolve(fileDir, include.path));
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = 'include 先を開く';
      return link;
    });
  }
}

/**
 * カーソル位置がラベル定義または参照の名前部分なら、その Range を返す
 *
 * @param document - 対象ドキュメント
 * @param position - カーソル位置
 * @returns ラベル名の Range、またはラベル位置でない場合は undefined
 */
export function resolveLabelNameRange(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Range | undefined {
  const lineText = document.lineAt(position.line).text;

  const def = extractLabelDefinition(lineText);
  if (def !== null) {
    const nameEnd = def.nameStart + def.name.length;
    if (position.character >= def.nameStart && position.character <= nameEnd) {
      return new vscode.Range(
        new vscode.Position(position.line, def.nameStart),
        new vscode.Position(position.line, nameEnd),
      );
    }
  }

  const refs = extractLabelReferences(lineText);
  for (const ref of refs) {
    const nameEnd = ref.nameStart + ref.name.length;
    if (position.character >= ref.nameStart && position.character <= nameEnd) {
      return new vscode.Range(
        new vscode.Position(position.line, ref.nameStart),
        new vscode.Position(position.line, nameEnd),
      );
    }
  }

  return undefined;
}

/**
 * TTL ラベルリネームプロバイダ
 *
 * @remarks F2 キーでラベル名を変更すると、定義（:label）と参照（goto/call）を一括置換
 */
export class TtlRenameProvider implements vscode.RenameProvider {
  /**
   * リネーム可能な範囲の確認
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @returns ラベル名の Range、またはリネーム不可な位置では undefined
   */
  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Range | undefined {
    return resolveLabelNameRange(document, position);
  }

  /**
   * リネーム用 WorkspaceEdit の提供
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @param newName - 新しいラベル名
   * @returns 定義・参照を一括置換する WorkspaceEdit
   */
  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
  ): vscode.WorkspaceEdit | undefined {
    const range = resolveLabelNameRange(document, position);
    if (range === undefined) return undefined;

    const oldName = document.getText(range).toLowerCase();
    const edit = new vscode.WorkspaceEdit();

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const lineText = document.lineAt(lineIndex).text;

      const def = extractLabelDefinition(lineText);
      if (def !== null && def.name === oldName) {
        edit.replace(
          document.uri,
          new vscode.Range(
            new vscode.Position(lineIndex, def.nameStart),
            new vscode.Position(lineIndex, def.nameStart + def.name.length),
          ),
          newName,
        );
        continue;
      }

      for (const ref of extractLabelReferences(lineText)) {
        if (ref.name !== oldName) continue;
        edit.replace(
          document.uri,
          new vscode.Range(
            new vscode.Position(lineIndex, ref.nameStart),
            new vscode.Position(lineIndex, ref.nameStart + ref.name.length),
          ),
          newName,
        );
      }
    }

    return edit;
  }
}

/**
 * ファイルリネーム時に include パスを更新する WorkspaceEdit を構築
 *
 * @param renames - リネーム対象ファイルのペア一覧
 * @returns include パスを更新する WorkspaceEdit
 */
export async function buildIncludeRenameEdit(
  renames: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>,
): Promise<vscode.WorkspaceEdit> {
  const edit = new vscode.WorkspaceEdit();
  const ttlRenames = renames.filter(r => r.oldUri.fsPath.endsWith('.ttl'));
  if (ttlRenames.length === 0) return edit;

  const ttlFiles = await vscode.workspace.findFiles('**/*.ttl');

  for (const fileUri of ttlFiles) {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const fileDir = nodePath.dirname(fileUri.fsPath);

    for (const include of extractIncludeDirectives(document.getText())) {
      const includedAbsolute = nodePath.resolve(fileDir, include.path);

      for (const rename of ttlRenames) {
        if (includedAbsolute !== rename.oldUri.fsPath) continue;

        const newRelative = nodePath
          .relative(fileDir, rename.newUri.fsPath)
          .replace(/\\/g, '/');

        edit.replace(
          fileUri,
          new vscode.Range(
            new vscode.Position(include.line, include.startCharacter),
            new vscode.Position(include.line, include.endCharacter),
          ),
          newRelative,
        );
      }
    }
  }

  return edit;
}

/**
 * VS Code の整形オプションから TTL 整形用のインデント単位を導出
 *
 * @param options - エディタの整形オプション
 * @returns TTL 整形オプション
 */
function toFormatOptions(options: vscode.FormattingOptions): FormatOptions {
  const indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  return { indentUnit };
}

/**
 * TTL ドキュメント整形プロバイダ
 *
 * @remarks ブロック構造のネストに応じてドキュメント全体を再インデントする
 */
class TtlFormattingProvider implements vscode.DocumentFormattingEditProvider {
  /**
   * ドキュメント全体の整形編集を提供
   *
   * @param document - 対象ドキュメント
   * @param options - エディタの整形オプション
   * @returns ドキュメント全体を整形後テキストに置き換える編集
   */
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
  ): vscode.TextEdit[] {
    const original = document.getText();
    const formatted = formatTtl(original, toFormatOptions(options));
    if (formatted === original) return [];

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(original.length),
    );
    return [vscode.TextEdit.replace(fullRange, formatted)];
  }
}

/**
 * TTL 診断を VS Code の Diagnostic に変換
 *
 * @param diagnostic - 解析結果の診断
 * @returns VS Code 診断オブジェクト
 */
function toVscodeDiagnostic(diagnostic: TtlDiagnostic): vscode.Diagnostic {
  const range = new vscode.Range(
    new vscode.Position(diagnostic.line, diagnostic.startCharacter),
    new vscode.Position(diagnostic.line, diagnostic.endCharacter),
  );
  const severity = diagnostic.severity === 'error'
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(range, diagnostic.message, severity);
  result.source = 'ttl';
  result.code = diagnostic.code;
  return result;
}

/**
 * ドキュメントの include 文を解決した URI 一覧を返す
 *
 * @param baseUri - include 文を含むドキュメントの URI
 * @param text - ドキュメントの全文
 * @returns include 先の絶対パス URI 配列
 */
function resolveIncludeUris(baseUri: vscode.Uri, text: string): vscode.Uri[] {
  const baseDir = nodePath.dirname(baseUri.fsPath);
  return extractIncludeDirectives(text).map(include =>
    vscode.Uri.file(nodePath.resolve(baseDir, include.path)),
  );
}

/**
 * include を再帰的に辿り、定義済みラベル名を収集
 *
 * @remarks
 * undefined-label 診断の誤検知を防ぐため、include 先で定義されたラベルを集める。
 * 1つでも include 先を開けなかった場合は `complete` を false とし、
 * 呼び出し側で undefined-label 検査を抑制できるようにする。
 *
 * @param startUri - 起点ドキュメントの URI
 * @param startText - 起点ドキュメントの全文
 * @returns 収集したラベル名（小文字）と、全 include を解決できたかのフラグ
 */
async function collectIncludedLabels(
  startUri: vscode.Uri,
  startText: string,
): Promise<{ readonly labels: ReadonlySet<string>; readonly complete: boolean }> {
  const labels = new Set<string>();
  const visited = new Set<string>([startUri.fsPath]);
  const queue = resolveIncludeUris(startUri, startText);
  let complete = true;

  while (queue.length > 0) {
    const uri = queue.shift();
    if (uri === undefined) break;
    if (visited.has(uri.fsPath)) continue;
    visited.add(uri.fsPath);

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      // include 先を開けない場合は解決不完全として記録
      complete = false;
      continue;
    }

    const text = document.getText();
    for (const symbol of extractDocumentSymbols(text)) {
      if (symbol.kind === 'label') labels.add(symbol.name.toLowerCase());
    }
    for (const childUri of resolveIncludeUris(uri, text)) queue.push(childUri);
  }

  return { labels, complete };
}

/**
 * ドキュメントを解析し診断コレクションを更新
 *
 * @param document - 対象ドキュメント
 * @param collection - 更新対象の診断コレクション
 */
async function refreshDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): Promise<void> {
  if (document.languageId !== TTL_LANGUAGE_ID) return;

  const config = vscode.workspace.getConfiguration('ttl');
  const maxNestingDepth = config.get<number>('maxNestingDepth', DEFAULT_MAX_NESTING_DEPTH);
  const checkUnknownCommand = config.get<boolean>('diagnostics.unknownCommand', true);
  const checkDuplicateLabel = config.get<boolean>('diagnostics.duplicateLabel', true);
  const undefinedLabelEnabled = config.get<boolean>('diagnostics.undefinedLabel', true);

  const text = document.getText();
  const version = document.version;

  const { labels: externalLabels, complete } = undefinedLabelEnabled
    ? await collectIncludedLabels(document.uri, text)
    : { labels: new Set<string>(), complete: true };

  // 非同期処理中にドキュメントが変更された場合は破棄（後続のイベントで再解析される）
  if (document.version !== version) return;

  collection.set(
    document.uri,
    analyzeTtl(text, {
      maxNestingDepth,
      externalLabels,
      // include 解決が不完全なときは誤検知を避けるため undefined-label を抑制
      checkUndefinedLabels: undefinedLabelEnabled && complete,
      checkUnknownCommand,
      checkDuplicateLabel,
    }).map(toVscodeDiagnostic),
  );
}

/** TTL デバッグ構成の type 識別子 */
const TTL_DEBUG_TYPE = 'ttl' as const;

/**
 * TTL マクロ実行用のデバッグ構成プロバイダ
 *
 * @remarks
 * 実際のデバッグは行わず、launch.json の構成（program / host / connectOptions / teraTermDir）から
 * `ttermpro.exe` を起動して即座に構成解決を中断（undefined を返す）する「ランチャ型」プロバイダ。
 * これにより「構成の追加」メニューに TTL が並び、F5 / ▶ でマクロを実行できる。
 */
class TtlDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  /**
   * 変数置換後のデバッグ構成を解決し、Tera Term を起動する
   *
   * @remarks
   * `${file}` や `${input:...}` が解決された後に呼ばれるため、ここで起動引数を確定できる。
   * 起動後は undefined を返してデバッグセッションを開始しない（デバッグアダプタ不要）。
   *
   * @param _folder - ワークスペースフォルダ（未使用）
   * @param config - 変数置換済みのデバッグ構成
   * @returns 常に undefined（セッションは開始しない）
   */
  resolveDebugConfigurationWithSubstitutedVariables(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    const program = typeof config.program === 'string' ? config.program.trim() : '';
    if (program === '') {
      void vscode.window.showErrorMessage(
        '実行するマクロ (program) が指定されていません。launch.json の "program" を確認してください。',
      );
      return undefined;
    }

    const configuredDir = typeof config.teraTermDir === 'string' ? config.teraTermDir : '';
    const teraTermDir = resolveTeraTermDir(
      configuredDir,
      DEFAULT_TERATERM_DIRS,
      path => nodeFs.existsSync(path),
    );
    if (teraTermDir === null) {
      void vscode.window.showErrorMessage(
        'Tera Term (ttermpro.exe) が見つかりません。launch.json の "teraTermDir" に Tera Term のフォルダを指定してください。',
      );
      return undefined;
    }

    const connect: TtlConnect =
      typeof config.connect === 'object' && config.connect !== null
        ? (config.connect as TtlConnect)
        : {};
    // 一般オプションは構成のトップレベルから読む（program/connect/teraTermDir 以外）
    const optionArgs = [
      ...buildConnectArgs(connect),
      ...buildTeraTermOptions(config as unknown as TeraTermOptions),
    ];

    const useTtpMacro = config.launcher === 'ttpmacro';
    let executable: string;
    let args: readonly string[];
    let tmpFile: string | undefined;

    if (useTtpMacro) {
      const connectArgs = buildConnectArgs(connect);
      let targetProgram = program;

      if (connectArgs.length > 0) {
        // connect 設定がある場合、ラッパーマクロを一時ファイルとして生成する。
        // changedir でユーザーマクロのディレクトリに移動してから include することで、
        // ユーザーマクロ内の相対パス include が正しく解決されるようにする。
        const macroDir = nodePath.win32.dirname(program);
        const connectStr = buildTtlConnectString(connect);
        const wrapperContent =
          `connect '${connectStr}'\n` +
          `changedir '${macroDir}'\n` +
          `include '${program}'\n`;
        tmpFile = nodePath.win32.join(nodeOs.tmpdir(), `ttl-wrapper-${Date.now()}.ttl`);
        nodeFs.writeFileSync(tmpFile, wrapperContent, 'utf8');
        targetProgram = tmpFile;
      }

      ({ executable, args } = buildTtpMacroLaunch(teraTermDir, targetProgram));
    } else {
      ({ executable, args } = buildTeraTermLaunch(teraTermDir, program, optionArgs));
    }

    try {
      const child = childProcess.spawn(executable, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.once('error', error => {
        if (tmpFile !== undefined) {
          try { nodeFs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
        void vscode.window.showErrorMessage(`マクロの起動に失敗しました: ${error.message}`);
      });
      child.unref();
      if (tmpFile !== undefined) {
        // ttpmacro.exe がラッパーマクロを読み込んだ後に削除する
        setTimeout(() => {
          try { nodeFs.unlinkSync(tmpFile!); } catch { /* ignore */ }
        }, 3000);
      }
      void vscode.window.showInformationMessage(`マクロを実行: ${nodePath.basename(program)}`);
    } catch (error) {
      if (tmpFile !== undefined) {
        try { nodeFs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`マクロの起動に失敗しました: ${message}`);
    }

    // デバッグセッションは開始しない（起動のみ）
    return undefined;
  }
}

/**
 * 拡張機能のアクティベーション
 *
 * @param context - 拡張機能コンテキスト
 */
export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: TTL_LANGUAGE_ID };

  const diagnostics = vscode.languages.createDiagnosticCollection('ttl');
  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(document => {
      void refreshDiagnostics(document, diagnostics);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      void refreshDiagnostics(event.document, diagnostics);
    }),
    vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
    // 設定変更時は開いている全ドキュメントを再解析（ttl.* のいずれかが変わったら反映）
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('ttl')) return;
      for (const document of vscode.workspace.textDocuments) {
        void refreshDiagnostics(document, diagnostics);
      }
    }),
    // include 先の編集が親ファイルの診断（undefined-label）に影響するため、保存時に全 .ttl を再解析
    vscode.workspace.onDidSaveTextDocument(saved => {
      if (saved.languageId !== TTL_LANGUAGE_ID) return;
      for (const document of vscode.workspace.textDocuments) {
        void refreshDiagnostics(document, diagnostics);
      }
    }),
  );
  // 起動時に既に開かれているドキュメントを解析
  for (const document of vscode.workspace.textDocuments) {
    void refreshDiagnostics(document, diagnostics);
  }

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new TtlCompletionProvider()),
    vscode.languages.registerHoverProvider(selector, new TtlHoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new TtlDefinitionProvider()),
    vscode.languages.registerReferenceProvider(selector, new TtlReferenceProvider()),
    vscode.languages.registerDocumentSymbolProvider(selector, new TtlDocumentSymbolProvider()),
    vscode.languages.registerDocumentLinkProvider(selector, new TtlDocumentLinkProvider()),
    vscode.languages.registerRenameProvider(selector, new TtlRenameProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(selector, new TtlFormattingProvider()),
    vscode.debug.registerDebugConfigurationProvider(
      TTL_DEBUG_TYPE,
      new TtlDebugConfigurationProvider(),
    ),
    vscode.workspace.onWillRenameFiles(event => {
      event.waitUntil(buildIncludeRenameEdit(event.files));
    }),
  );
}

/** 拡張機能の非アクティベーション */
export function deactivate(): void {
  // クリーンアップ不要（subscriptions が自動的に dispose される）
}
