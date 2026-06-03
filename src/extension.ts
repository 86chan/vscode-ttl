/**
 * TTL (Tera Term Language) VSCode拡張機能エントリポイント
 */

import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { extractLabelDefinition, extractLabelReferences } from './labelUtils';
import {
  type TtlCommand,
  TTL_COMMANDS_MAP,
  TTL_STRUCTURAL_KEYWORDS,
  TTL_SYSTEM_VARIABLES,
} from './ttlData';

const TTL_LANGUAGE_ID = 'ttl' as const;

/** ラベル定義行のパターン（行頭コロン） */
const LABEL_DEFINITION_PATTERN = /^\s*:(\w+)/;

/** ラベル参照行のパターン（goto/callの引数） */
const LABEL_REFERENCE_PREFIX = /(?:goto|call)\s+$/i;

/** include文のパターン（シングルクォート内のパス） */
const INCLUDE_PATTERN = /\binclude\s+'([^']+)'/gi;

/**
 * 設定またはVSCode UIの言語から表示言語を解決
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
 * @returns MarkdownStringホバーコンテンツ
 */
function buildHoverMarkdown(command: TtlCommand, language: 'ja' | 'en'): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  // isTrusted は明示的に false のまま（command: URI によるコマンド実行を許可しない）
  markdown.appendCodeblock(command.signature, 'ttl');
  markdown.appendMarkdown(selectDescription(command, language));
  return markdown;
}

/**
 * ドキュメント内の全ラベル定義を収集
 *
 * @param document - 対象ドキュメント
 * @returns ラベル名（小文字）から定義位置へのマップ
 */
function collectLabelDefinitions(
  document: vscode.TextDocument
): ReadonlyMap<string, vscode.Position> {
  const labels = new Map<string, vscode.Position>();
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const line = document.lineAt(lineIndex);
    const match = LABEL_DEFINITION_PATTERN.exec(line.text);
    if (match !== null) {
      const colonIndex = line.text.indexOf(':' + match[1]);
      labels.set(match[1].toLowerCase(), new vscode.Position(lineIndex, colonIndex));
    }
  }
  return labels;
}

/**
 * TTL補完プロバイダ
 *
 * @remarks コマンド・キーワード・システム変数の補完候補を提供
 */
class TtlCompletionProvider implements vscode.CompletionItemProvider {
  /**
   * 補完候補一覧の提供
   *
   * @param _document - 対象ドキュメント
   * @param _position - カーソル位置
   * @returns 補完候補の配列
   */
  provideCompletionItems(
    _document: vscode.TextDocument,
    _position: vscode.Position,
  ): vscode.CompletionItem[] {
    const language = resolveDisplayLanguage();
    const commandItems = this.buildCommandItems(language);
    const keywordItems = this.buildKeywordItems();
    const variableItems = this.buildVariableItems();
    return [...commandItems, ...keywordItems, ...variableItems];
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
}

/**
 * TTLホバープロバイダ
 *
 * @remarks コマンド上にカーソルを置いたときのドキュメントを提供
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
 * TTL定義ジャンププロバイダ
 *
 * @remarks goto/call コマンドのラベル参照から定義位置へのジャンプを提供
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
  ): vscode.Location | undefined {
    const range = document.getWordRangeAtPosition(position, /\w+/);
    if (range === undefined) return undefined;

    const lineText = document.lineAt(position.line).text;
    const textBeforeWord = lineText.substring(0, range.start.character);

    if (!LABEL_REFERENCE_PREFIX.test(textBeforeWord)) return undefined;

    const labelName = document.getText(range).toLowerCase();
    const labels = collectLabelDefinitions(document);
    const labelPosition = labels.get(labelName);

    if (labelPosition === undefined) return undefined;
    return new vscode.Location(document.uri, labelPosition);
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
 * TTLラベルリネームプロバイダ
 *
 * @remarks F2 でラベル名を変更すると定義（:label）と参照（goto/call）を一括置換
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

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const lineText = document.lineAt(lineIndex).text;
      INCLUDE_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = INCLUDE_PATTERN.exec(lineText)) !== null) {
        const includedRelative = match[1];
        const includedAbsolute = nodePath.resolve(fileDir, includedRelative);

        for (const rename of ttlRenames) {
          if (includedAbsolute !== rename.oldUri.fsPath) continue;

          const newRelative = nodePath
            .relative(fileDir, rename.newUri.fsPath)
            .replace(/\\/g, '/');

          const pathStart = match.index + match[0].indexOf(match[1]);
          edit.replace(
            fileUri,
            new vscode.Range(
              new vscode.Position(lineIndex, pathStart),
              new vscode.Position(lineIndex, pathStart + match[1].length),
            ),
            newRelative,
          );
        }
      }
    }
  }

  return edit;
}

/**
 * 拡張機能のアクティベーション
 *
 * @param context - 拡張機能コンテキスト
 */
export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: TTL_LANGUAGE_ID };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new TtlCompletionProvider()),
    vscode.languages.registerHoverProvider(selector, new TtlHoverProvider()),
    vscode.languages.registerDefinitionProvider(selector, new TtlDefinitionProvider()),
    vscode.languages.registerRenameProvider(selector, new TtlRenameProvider()),
    vscode.workspace.onWillRenameFiles(event => {
      event.waitUntil(buildIncludeRenameEdit(event.files));
    }),
  );
}

/** 拡張機能の非アクティベーション */
export function deactivate(): void {
  // クリーンアップ不要（subscriptions が自動的に dispose される）
}
