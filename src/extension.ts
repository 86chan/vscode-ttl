// TTL (Tera Term Language) VS Code 拡張機能のエントリポイント

import * as childProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import {
  collectDocumentWords,
  resolveDocHeaderTriggerStart,
  TTL_IDENTIFIER_PATTERN,
} from './completionUtils';
import {
  type IncludePathContext,
  rankSimilarPaths,
  resolveIncludePathContext,
} from './includePathUtils';
import { analyzeTtl, DEFAULT_MAX_NESTING_DEPTH, type TtlDiagnostic } from './diagnosticsUtils';
import {
  buildConnectArgs,
  buildTeraTermLaunch,
  buildTeraTermOptions,
  buildTtlConnectString,
  buildTtpMacroAttachLaunch,
  buildTtpMacroLaunch,
  DEFAULT_TERATERM_DIRS,
  ENUM_VT_WINDOWS_PS_SCRIPT,
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
  resolveIncludeRootFile,
  resolveIncludeTarget,
  type TtlSymbol,
} from './navigationUtils';
import {
  buildReferenceUrl,
  type TtlCommand,
  type TtlParameter,
  TTL_COMMANDS_MAP,
  TTL_DOC_HEADER_SNIPPETS,
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
 * コマンドの戻り値説明を表示言語に応じて選択
 *
 * @param command - TTLコマンド定義
 * @param language - 表示言語
 * @returns 選択された戻り値説明、または未定義の場合は undefined
 */
function selectReturns(command: TtlCommand, language: 'ja' | 'en'): string | undefined {
  if (language === 'ja' && command.returnsJa !== undefined) {
    return command.returnsJa;
  }
  return command.returns;
}

/**
 * 引数の説明を表示言語に応じて選択
 *
 * @param param - TTL引数定義
 * @param language - 表示言語
 * @returns 選択された引数の説明
 */
function selectParameterDescription(param: TtlParameter, language: 'ja' | 'en'): string {
  if (language === 'ja' && param.descriptionJa !== undefined) {
    return param.descriptionJa;
  }
  return param.description;
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
  markdown.appendMarkdown(selectDescription(command, language).trim());
  if (command.parameters !== undefined && command.parameters.length > 0) {
    const heading = language === 'ja' ? '引数' : 'Arguments';
    const optionalNote = language === 'ja' ? '（省略可）' : '(optional)';
    const lines = command.parameters.map(param => {
      const suffix = param.optional === true ? ` ${optionalNote}` : '';
      return `- \`${param.name}\`${suffix} … ${selectParameterDescription(param, language).trim()}`;
    });
    markdown.appendMarkdown(`\n\n---\n\n**${heading}**\n\n${lines.join('\n')}`);
  }
  const returns = selectReturns(command, language);
  if (returns !== undefined) {
    const heading = language === 'ja' ? '戻り値' : 'Return value';
    markdown.appendMarkdown(`\n\n---\n\n**${heading}**\n\n${returns.trim()}`);
  }
  const referenceUrl = buildReferenceUrl(command, language);
  const referenceLabel = language === 'ja' ? '公式ドキュメント' : 'Official documentation';
  markdown.appendMarkdown(`\n\n---\n\n[${referenceLabel}](${referenceUrl})`);
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
 * @param sameFileOnly - true の場合 include 先を辿らず起点ファイル内のみを探索する
 * @returns ラベル定義の位置、または見つからない場合は undefined
 */
async function findLabelDefinitionAcrossFiles(
  startUri: vscode.Uri,
  startText: string,
  labelName: string,
  sameFileOnly: boolean,
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

    // 同一ファイル限定モードでは include 先を探索しない
    if (sameFileOnly) continue;

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
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    // `///` トリガ時はドキュメントヘッダスニペットのみを提示し、入力したスラッシュを置換する
    const lineTextBeforeCursor = document
      .lineAt(position.line)
      .text.slice(0, position.character);
    const triggerStart = resolveDocHeaderTriggerStart(lineTextBeforeCursor);
    if (triggerStart !== undefined) {
      const range = new vscode.Range(
        new vscode.Position(position.line, triggerStart),
        position,
      );
      return this.buildDocHeaderItems(range);
    }

    // include 'path' 入力中はパス候補（フォルダ・.ttl）のみを提示する
    const includeContext = resolveIncludePathContext(lineTextBeforeCursor);
    if (includeContext !== undefined) {
      return this.buildIncludePathItems(document, position, includeContext);
    }

    const language = resolveDisplayLanguage();
    const commandItems = this.buildCommandItems(language);
    const keywordItems = this.buildKeywordItems();
    const variableItems = this.buildVariableItems();
    const documentWordItems = this.buildDocumentWordItems(document, position);
    return [...commandItems, ...keywordItems, ...variableItems, ...documentWordItems];
  }

  /**
   * ドキュメントヘッダスニペットの補完候補を生成
   *
   * @param range - 入力済みのスラッシュを置換する範囲
   * @returns ドキュメントヘッダスニペットの補完候補
   */
  private buildDocHeaderItems(range: vscode.Range): vscode.CompletionItem[] {
    return TTL_DOC_HEADER_SNIPPETS.map(snippet => {
      const item = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet);
      item.detail = snippet.detail;
      item.documentation = new vscode.MarkdownString(snippet.documentation);
      item.insertText = new vscode.SnippetString(snippet.body);
      item.filterText = snippet.label;
      item.range = range;
      return item;
    });
  }

  /**
   * include パス補完候補（フォルダ・.ttl ファイル）の生成
   *
   * @remarks
   * 解決基準ディレクトリ（resolveIncludeBaseDir）配下の入力済みディレクトリを列挙し、
   * フォルダと .ttl ファイルを候補化する。フォルダ選択時は再サジェストを発火し、
   * 自己 include を避けるため対象ドキュメント自身は除外する。
   *
   * @param document - 対象ドキュメント
   * @param position - カーソル位置
   * @param context - include パス入力文脈
   * @returns 補完候補（読み取り失敗時は空配列）
   */
  private async buildIncludePathItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: IncludePathContext,
  ): Promise<vscode.CompletionItem[]> {
    const baseDir = await resolveIncludeBaseDir(document);
    const directory = nodePath.resolve(baseDir, context.directoryPart);

    let entries: readonly nodeFs.Dirent[];
    try {
      entries = await nodeFs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      // ディレクトリが存在しない／読み取れない場合は候補なし
      return [];
    }

    // namePart を置換範囲とし、入力済みのファイル名部分を確実に上書きする
    const replaceRange = new vscode.Range(
      new vscode.Position(position.line, context.replaceStart),
      position,
    );
    const ownFsPath = document.uri.fsPath;

    const items: vscode.CompletionItem[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Folder);
        // フォルダ選択後はそのまま下位を続けて補完できるよう区切り文字を付与し再サジェスト
        item.insertText = `${entry.name}/`;
        item.range = replaceRange;
        item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
        items.push(item);
        continue;
      }

      if (!entry.isFile() || nodePath.extname(entry.name).toLowerCase() !== '.ttl') continue;
      // 自己 include を避けるため対象ドキュメント自身は候補から除外
      if (nodePath.resolve(directory, entry.name) === ownFsPath) continue;

      const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.File);
      item.insertText = entry.name;
      item.range = replaceRange;
      items.push(item);
    }
    return items;
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
 * `ttl.requireLabelInSameFile` が有効な場合は include 先を辿らず
 * 同一ファイル内のみを探索する。
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
    const sameFileOnly = vscode.workspace
      .getConfiguration('ttl')
      .get<boolean>('requireLabelInSameFile', false);
    return findLabelDefinitionAcrossFiles(document.uri, document.getText(), labelName, sameFileOnly);
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
 * include ジャンプの基準ディレクトリを解決する
 *
 * @remarks
 * Tera Term の include はカレントディレクトリが最上位（エントリポイント）の親マクロの
 * 位置を基準とする。設定 `ttl.includeRootDir` があればそれを優先し、無ければワークスペースを
 * 走査して対象ドキュメントの最上位の親マクロを特定し、そのディレクトリを基準とする。
 * いずれも解決できない場合はドキュメント自身のディレクトリ（従来挙動）にフォールバックする。
 *
 * @param document - include 文を含む対象ドキュメント
 * @returns include パス解決の基準ディレクトリ（絶対パス）
 */
async function resolveIncludeBaseDir(document: vscode.TextDocument): Promise<string> {
  const ownDir = nodePath.dirname(document.uri.fsPath);

  // 1. 設定による上書き（絶対パスはそのまま、相対パスはワークスペースフォルダ基準）
  const configured = vscode.workspace
    .getConfiguration('ttl')
    .get<string>('includeRootDir', '')
    .trim();
  if (configured.length > 0) {
    if (nodePath.isAbsolute(configured)) return configured;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return folder !== undefined ? nodePath.resolve(folder.uri.fsPath, configured) : ownDir;
  }

  // 2. 自動検出: ワークスペースの全 .ttl から include グラフを構築し最上位の親を特定
  try {
    const files = await vscode.workspace.findFiles('**/*.ttl');
    const includeMap = new Map<string, readonly string[]>();
    for (const fileUri of files) {
      const text = (await vscode.workspace.openTextDocument(fileUri)).getText();
      includeMap.set(
        fileUri.fsPath,
        extractIncludeDirectives(text).map(include => include.path),
      );
    }
    const rootFile = resolveIncludeRootFile(document.uri.fsPath, includeMap);
    return nodePath.dirname(rootFile);
  } catch {
    return ownDir;
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
  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const baseDir = await resolveIncludeBaseDir(document);
    return extractIncludeDirectives(document.getText()).map(include => {
      const range = new vscode.Range(
        new vscode.Position(include.line, include.startCharacter),
        new vscode.Position(include.line, include.endCharacter),
      );
      const target = vscode.Uri.file(resolveIncludeTarget(baseDir, include.path));
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
 * `ttl.format.*` 設定から整形の挙動トグルを読み出す
 *
 * @param resource - 設定スコープを解決するリソース（フォルダー別設定の反映用）
 * @returns 桁揃え・空白正規化・空行圧縮のオプション
 */
function readFormatToggles(
  resource?: vscode.Uri,
): Pick<FormatOptions, 'alignCommentTables' | 'normalizeOperatorSpacing' | 'maxConsecutiveBlankLines'> {
  const config = vscode.workspace.getConfiguration('ttl', resource ?? null);
  return {
    alignCommentTables: config.get<boolean>('format.alignCommentTables', true),
    normalizeOperatorSpacing: config.get<boolean>('format.normalizeOperatorSpacing', true),
    maxConsecutiveBlankLines: config.get<number>('format.maxConsecutiveBlankLines', 1),
  };
}

/**
 * VS Code の整形オプションと `ttl.format.*` 設定から TTL 整形オプションを導出
 *
 * @param options - エディタの整形オプション
 * @param resource - 設定スコープを解決するリソース
 * @returns TTL 整形オプション
 */
function toFormatOptions(options: vscode.FormattingOptions, resource?: vscode.Uri): FormatOptions {
  const indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  return { indentUnit, ...readFormatToggles(resource) };
}

/**
 * 指定リソースに適用されるエディタのインデント単位を解決する
 *
 * @remarks ワークスペース一括整形のように `vscode.FormattingOptions` が得られない場面で、
 * `editor.insertSpaces` / `editor.tabSize`（TTL 言語スコープ）からインデント単位を求める
 *
 * @param resource - 設定スコープを解決するリソース
 * @returns インデント1段分の文字列
 */
function resolveIndentUnit(resource: vscode.Uri): string {
  const editorConfig = vscode.workspace.getConfiguration('editor', {
    uri: resource,
    languageId: TTL_LANGUAGE_ID,
  });
  const insertSpaces = editorConfig.get<boolean>('insertSpaces', true);
  const tabSize = editorConfig.get<number>('tabSize', 2);
  const width = typeof tabSize === 'number' && tabSize > 0 ? tabSize : 2;
  return insertSpaces ? ' '.repeat(width) : '\t';
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
    const formatted = formatTtl(original, toFormatOptions(options, document.uri));
    if (formatted === original) return [];

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(original.length),
    );
    return [vscode.TextEdit.replace(fullRange, formatted)];
  }
}

/** ワークスペース一括整形のファイル選択肢 */
interface TtlFileQuickPickItem extends vscode.QuickPickItem {
  /** 対象ファイルの URI */
  readonly uri: vscode.Uri;
}

/**
 * ワークスペース内の `.ttl` を選択して一括整形するコマンド本体
 *
 * @remarks
 * `**\/*.ttl` を走査し、QuickPick で対象ファイルを複数選択させたうえで、
 * `ttl.format.*` 設定とエディタのインデント設定に従って整形・保存する
 */
async function formatWorkspaceCommand(): Promise<void> {
  const files = await vscode.workspace.findFiles('**/*.ttl');
  if (files.length === 0) {
    void vscode.window.showInformationMessage('整形対象の .ttl ファイルが見つかりませんでした');
    return;
  }

  // 既定で全選択にしておき、必要に応じて絞り込めるようにする
  const items: TtlFileQuickPickItem[] = files
    .map(uri => ({
      label: vscode.workspace.asRelativePath(uri),
      uri,
      picked: true,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: '整形する TTL ファイルを選択',
    placeHolder: '整形するファイルを選択（既定で全選択）',
  });
  if (selected === undefined || selected.length === 0) return;

  let changedCount = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'TTL を整形中…' },
    async progress => {
      for (let index = 0; index < selected.length; index++) {
        const item = selected[index];
        progress.report({
          message: item.label,
          increment: (100 / selected.length),
        });

        const document = await vscode.workspace.openTextDocument(item.uri);
        const original = document.getText();
        const indentUnit = resolveIndentUnit(item.uri);
        const formatted = formatTtl(original, { indentUnit, ...readFormatToggles(item.uri) });
        if (formatted === original) continue;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          item.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(original.length)),
          formatted,
        );
        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
          await document.save();
          changedCount += 1;
        }
      }
    },
  );

  void vscode.window.showInformationMessage(
    `${selected.length} 件中 ${changedCount} 件の TTL ファイルを整形しました`,
  );
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
  const requireLabelInSameFile = config.get<boolean>('requireLabelInSameFile', false);
  const checkIncludeNotFound = config.get<boolean>('diagnostics.includeNotFound', true);

  const text = document.getText();
  const version = document.version;

  // 同一ファイル限定モードでは include 先を参照しないため、include 解決は不要
  const { labels: externalLabels, complete } = undefinedLabelEnabled && !requireLabelInSameFile
    ? await collectIncludedLabels(document.uri, text)
    : { labels: new Set<string>(), complete: true };

  // include 先の存在チェックは FS アクセスを伴うため analyzeTtl とは分けて合成する
  const includeDiagnostics = checkIncludeNotFound
    ? await findMissingIncludeDiagnostics(document, text)
    : [];

  // 非同期処理中にドキュメントが変更された場合は破棄（後続のイベントで再解析される）
  if (document.version !== version) return;

  collection.set(document.uri, [
    ...analyzeTtl(text, {
      maxNestingDepth,
      externalLabels,
      // include 解決が不完全なときは誤検知を避けるため undefined-label を抑制
      // （同一ファイル限定モードは include 解決に依存しないため complete を要求しない）
      checkUndefinedLabels: undefinedLabelEnabled && (requireLabelInSameFile || complete),
      requireLabelInSameFile,
      checkUnknownCommand,
      checkDuplicateLabel,
    }).map(toVscodeDiagnostic),
    ...includeDiagnostics,
  ]);
}

/** include 先未検出を示す診断コード */
const INCLUDE_NOT_FOUND_CODE = 'include-not-found' as const;

/**
 * 解決先が存在しない include 文の診断を収集
 *
 * @remarks
 * 解決基準ディレクトリ（resolveIncludeBaseDir）で各 include を解決し、実体が無いものを
 * 警告として報告する。範囲は引用符内のパス文字列部分のみとする。
 *
 * @param document - 対象ドキュメント
 * @param text - ドキュメント全文
 * @returns 未検出 include の診断配列
 */
async function findMissingIncludeDiagnostics(
  document: vscode.TextDocument,
  text: string,
): Promise<vscode.Diagnostic[]> {
  const baseDir = await resolveIncludeBaseDir(document);
  const directives = extractIncludeDirectives(text);

  const checks = await Promise.all(
    directives.map(async include => {
      const target = resolveIncludeTarget(baseDir, include.path);
      try {
        await nodeFs.promises.access(target);
        return undefined;
      } catch {
        const range = new vscode.Range(
          new vscode.Position(include.line, include.startCharacter),
          new vscode.Position(include.line, include.endCharacter),
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          `include 先が見つかりません: '${include.path}'`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'ttl';
        diagnostic.code = INCLUDE_NOT_FOUND_CODE;
        return diagnostic;
      }
    }),
  );

  return checks.filter((diagnostic): diagnostic is vscode.Diagnostic => diagnostic !== undefined);
}

/** クイックフィックスで提示する類似 include 候補の最大件数 */
const INCLUDE_FIX_SUGGESTION_LIMIT = 3;

/**
 * include 未検出診断に対するクイックフィックスプロバイダ
 *
 * @remarks include-not-found 診断に対し、似た名前の既存 .ttl への置換アクションを提供する
 */
class TtlIncludeCodeActionProvider implements vscode.CodeActionProvider {
  /** 提供するコードアクション種別 */
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix] as const;

  /**
   * include 未検出診断に対する置換アクションの提供
   *
   * @param document - 対象ドキュメント
   * @param _range - 対象範囲（未使用、診断は context から取得）
   * @param context - 対象範囲に紐づく診断を含むコンテキスト
   * @returns 類似パスへの置換クイックフィックス配列
   */
  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const targets = context.diagnostics.filter(
      diagnostic => diagnostic.code === INCLUDE_NOT_FOUND_CODE,
    );
    if (targets.length === 0) return [];

    const baseDir = await resolveIncludeBaseDir(document);
    // ワークスペース内の全 .ttl を基準ディレクトリ相対のパス候補へ変換（区切りは / に正規化）
    const files = await vscode.workspace.findFiles('**/*.ttl');
    const candidates = files
      .map(uri => nodePath.relative(baseDir, uri.fsPath))
      .filter(relative => relative.length > 0 && !relative.startsWith('..'))
      .map(relative => relative.split(nodePath.sep).join('/'));

    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of targets) {
      const typed = document.getText(diagnostic.range);
      for (const suggestion of rankSimilarPaths(typed, candidates, INCLUDE_FIX_SUGGESTION_LIMIT)) {
        const action = new vscode.CodeAction(
          `'${suggestion}' に置換`,
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [diagnostic];
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, suggestion);
        actions.push(action);
      }
    }
    return actions;
  }
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
  async resolveDebugConfigurationWithSubstitutedVariables(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
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

    const launcher = config.launcher === 'ttpmacro' ? 'ttpmacro'
      : config.launcher === 'ttpmacro-attach' ? 'ttpmacro-attach'
      : 'ttermpro';

    let executable: string;
    let args: readonly string[];
    let tmpFile: string | undefined;

    if (launcher === 'ttpmacro-attach') {
      const picked = await this.pickTeraTermWindow();
      if (picked === undefined) return undefined;
      ({ executable, args } = buildTtpMacroAttachLaunch(teraTermDir, picked, program));
    } else if (launcher === 'ttpmacro') {
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

  /**
   * PowerShell で起動中の ttermpro.exe ウィンドウを列挙し、QuickPick で選択させる
   *
   * @returns 選択された HWND の 8 桁大文字 16 進文字列。キャンセルまたはエラー時は undefined。
   */
  private async pickTeraTermWindow(): Promise<string | undefined> {
    const psScript = ENUM_VT_WINDOWS_PS_SCRIPT;
    const tmpPs = nodePath.join(nodeOs.tmpdir(), `ttl-enumwnd-${Date.now()}.ps1`);
    nodeFs.writeFileSync(tmpPs, psScript, 'utf8');

    let stdout: string;
    try {
      stdout = await new Promise<string>((resolve, reject) => {
        childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs],
          { encoding: 'utf8' },
          (err, out) => { err ? reject(err) : resolve(out); },
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Tera Term ウィンドウの列挙に失敗しました: ${msg}`);
      return undefined;
    } finally {
      try { nodeFs.unlinkSync(tmpPs); } catch { /* ignore */ }
    }

    // 出力は "HWND_HEX\tWindowTitle" の行リスト（空行を除外）
    const windows = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const tab = line.indexOf('\t');
        const hwnd = tab >= 0 ? line.slice(0, tab) : line;
        const title = tab >= 0 ? line.slice(tab + 1) : line;
        return { hwnd, title };
      });

    if (windows.length === 0) {
      void vscode.window.showErrorMessage(
        '起動中の Tera Term ウィンドウが見つかりません。先に Tera Term を起動してください。',
      );
      return undefined;
    }

    if (windows.length === 1) return windows[0].hwnd;

    const items = windows.map(w => ({ label: w.title, description: `HWND: ${w.hwnd}`, hwnd: w.hwnd }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'マクロを実行する Tera Term ウィンドウを選択してください',
    });
    return picked?.hwnd;
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
    vscode.languages.registerCompletionItemProvider(
      selector,
      new TtlCompletionProvider(),
      '/',
      '\\',
      "'",
    ),
    vscode.languages.registerHoverProvider(selector, new TtlHoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new TtlDefinitionProvider()),
    vscode.languages.registerReferenceProvider(selector, new TtlReferenceProvider()),
    vscode.languages.registerDocumentSymbolProvider(selector, new TtlDocumentSymbolProvider()),
    vscode.languages.registerDocumentLinkProvider(selector, new TtlDocumentLinkProvider()),
    vscode.languages.registerCodeActionsProvider(selector, new TtlIncludeCodeActionProvider(), {
      providedCodeActionKinds: TtlIncludeCodeActionProvider.providedCodeActionKinds,
    }),
    vscode.languages.registerRenameProvider(selector, new TtlRenameProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(selector, new TtlFormattingProvider()),
    vscode.commands.registerCommand('ttl.formatWorkspace', () => formatWorkspaceCommand()),
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
