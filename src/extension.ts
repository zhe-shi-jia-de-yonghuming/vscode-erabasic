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
  // context.subscriptions.push(
  //   vscode.languages.registerDocumentFormattingEditProvider(
  //     selector,
  //     new EraBasicDocumentFormattingEditProvider(diagnostics)
  //   )
  // );
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
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider
{
  private diagonostics: vscode.DiagnosticCollection;
  private config: vscode.WorkspaceConfiguration;

  constructor(diagnostics: vscode.DiagnosticCollection) {
    this.diagonostics = diagnostics;
    this.config = vscode.workspace.getConfiguration("erabasic");
  }

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    var indenter = new EraBasicIndenter(
      this.config,
      options
    )
    return this.indent(document, range, indenter);
  }

  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    var indenter = new EraBasicIndenter(
      this.config,
      options
    )
    return this.indent(
      document,
      new vscode.Range(0, 0, document.lineCount, 0),
      indenter
    );
  }

  private indent(
    document: vscode.TextDocument,
    range: vscode.Range,
    indenter: EraBasicIndenter
  ): vscode.TextEdit[] {
    if (this.diagonostics.get(document.uri) !== undefined) {
      // show a notification for you cannot format a document with errors here
      vscode.window.showErrorMessage("Cannot format a document with errors");
      return [];
    }
    
    const ret: vscode.TextEdit[] = [];

    for (let line = range.start.line; line <= range.end.line; line++) {
      indenter.updateNext();

      const textLine = document.lineAt(line);
      indenter.resolve(textLine);

      indenter.updateCurrent();
      const result = indenter.setIndent(textLine.text);

      ret.push(new vscode.TextEdit(textLine.range, result)); }

    return ret;
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
