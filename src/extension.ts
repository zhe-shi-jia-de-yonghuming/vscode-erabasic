import * as vscode from "vscode";

import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemProvider,
  Definition,
  DefinitionProvider,
  DocumentSelector,
  DocumentSymbolProvider,
  ExtensionContext,
  Position,
  SymbolInformation,
  TextDocument,
  WorkspaceSymbolProvider,
} from "vscode";

import {
  GetBuiltinComplationItems,
  CompletionItemRepository,
  declToCompletionItem,
} from "./completion";
import { DeclarationProvider, readDeclarations } from "./declaration";
import { DefinitionRepository } from "./definition";
import { EraHoverProvider } from "./hover";
import { readSymbolInformations, SymbolInformationRepository } from "./symbol";
import { EraBasicIndenter } from "./indent";
import { subscribeToDocumentChanges } from "./diagnostics";

export let extensionPath: string;

export function activate(context: ExtensionContext) {
  const selector: DocumentSelector = { language: "erabasic" };
  const provider: DeclarationProvider = new DeclarationProvider(context);
  const diagnostics =
    vscode.languages.createDiagnosticCollection("erabasicIndenter");
  subscribeToDocumentChanges(context, diagnostics);
  extensionPath = context.extensionPath;
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new EraBasicCompletionItemProvider(provider)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      selector,
      new EraBasicDefinitionProvider(provider)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      selector,
      new EraBasicDocumentSymbolProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(
      new EraBasicWorkspaceSymbolProvider(provider)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector,
      new EraBasicDocumentFormattingEditProvider(diagnostics)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      selector,
      new EraHoverProvider(provider)
    )
  );
  context.subscriptions.push(provider);
  context.subscriptions.push(diagnostics);
}

export function deactivate() {
  // Nothing to do
}

class EraBasicCompletionItemProvider implements CompletionItemProvider {
  private repo: CompletionItemRepository;
  private options: EraBasicOption;

  constructor(provider: DeclarationProvider) {
    this.repo = new CompletionItemRepository(provider);
    this.options = new EraBasicOption();
  }

  public provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<CompletionItem[]> {
    if (!this.options.completionWorkspaceSymbols) {
      return Promise.resolve(
        GetBuiltinComplationItems().concat(
          readDeclarations(document.getText())
            .filter((d) => d.visible(position))
            .map((decreation) => {
              return declToCompletionItem(decreation);
            })
        )
      );
    }

    return this.repo.sync().then(() => {
      const res = GetBuiltinComplationItems().concat(
        ...this.repo.find(document, position)
      );
      return res;
    });
  }
}

class EraBasicDefinitionProvider implements DefinitionProvider {
  private repo: DefinitionRepository;

  constructor(provider: DeclarationProvider) {
    this.repo = new DefinitionRepository(provider);
  }

  public provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Definition> {
    return this.repo
      .sync()
      .then(() => Array.from(this.repo.find(document, position)));
  }
}

class EraBasicDocumentSymbolProvider implements DocumentSymbolProvider {
  public provideDocumentSymbols(
    document: TextDocument,
    token: CancellationToken
  ): SymbolInformation[] {
    return readSymbolInformations(document.uri, document.getText());
  }
}

class EraBasicWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
  private repo: SymbolInformationRepository;

  constructor(provider: DeclarationProvider) {
    this.repo = new SymbolInformationRepository(provider);
  }

  public provideWorkspaceSymbols(
    query: string,
    token: CancellationToken
  ): Promise<SymbolInformation[]> {
    return this.repo.sync().then(() => Array.from(this.repo.find(query)));
  }
}

class EraBasicDocumentFormattingEditProvider
  implements vscode.DocumentRangeFormattingEditProvider
{
  private diagnostics: vscode.DiagnosticCollection;
  private config: vscode.WorkspaceConfiguration;

  constructor(diagnostics: vscode.DiagnosticCollection) {
    this.diagnostics = diagnostics;
    this.config = vscode.workspace.getConfiguration("erabasic");
  }

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    var indenter = new EraBasicIndenter(this.config, options);
    return this.indent(document, range, indenter);
  }

  /**
   * Formats the indentation of a given range in a text document.
   *
   * @param {vscode.TextDocument} document - The text document to format.
   * @param {vscode.Range} range - The range to format.
   * @param {EraBasicIndenter} indenter - The indenter object used for formatting.
   * @return {vscode.TextEdit[]} An array of text edits representing the formatted indentation.
   */
  private indent(
    document: vscode.TextDocument,
    range: vscode.Range,
    indenter: EraBasicIndenter
  ): vscode.TextEdit[] {
    if (this.diagnostics.has(document.uri)) {
      vscode.window.showErrorMessage("Cannot format a document with errors");
      return [];
    }

    const textEdits: vscode.TextEdit[] = [];

    // Iterate the whole document
    for (let line = 0; line < document.lineCount; line++) {
      indenter.updateNext();

      const textLine = document.lineAt(line);
      indenter.resolve(textLine);

      indenter.updateCurrent();

      // only format the given range
      if (line >= range.start.line && line <= range.end.line) {
        const newIndent = indenter.setIndent(textLine.text);

        if (newIndent === textLine.text) continue;

        const textEdit = new vscode.TextEdit(textLine.range, newIndent);
        textEdits.push(textEdit);
      }
    }

    return textEdits;
  }
}

export class EraBasicOption {
  public get completionWorkspaceSymbols(): boolean {
    return vscode.workspace
      .getConfiguration("erabasic")
      .get("completionWorkspaceSymbols", false);
  }
  public get completionWorkspaceByMultiProcess(): boolean {
    return vscode.workspace
      .getConfiguration("erabasic")
      .get("completionWorkspaceByMultiProcess", false);
  }
  public get functionIndent(): boolean {
    return vscode.workspace
      .getConfiguration("erabasic")
      .get("functionIndent", false);
  }
}
