/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from "vscode";
import { BlockType, EraBasicIndenter } from "./indent";

/**
 * Analyzes the text document for problems.
 * This demo diagnostic problem provider finds all mentions of 'emoji'.
 * @param doc text document to analyze
 * @param blockDiagnostics diagnostic collection
 */
export function refreshDiagnostics(
  doc: vscode.TextDocument,
  blockDiagnostics: vscode.DiagnosticCollection
): void {
  const indenter = new EraBasicIndenter(
    vscode.workspace.getConfiguration("erabasic"),
    null
  );
  const diagnostics: vscode.Diagnostic[] = [];

  for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
    const lineOfText = doc.lineAt(lineIndex);
    indenter.resolve(lineOfText);
    if (indenter.error.diagnostic !== null) {
      diagnostics.push(indenter.error.diagnostic);
      indenter.error.diagnostic = null;
    }
  }
  var blocks = indenter.getBlocks();
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks.getByIndex(i);
    if (block) {
      var diagnostic = new vscode.Diagnostic(
        block.controlRange,
        `Missing end identifier for block ${BlockType[block.type]}.`
      );
      diagnostics.push(diagnostic);
    }
  }
  blockDiagnostics.set(doc.uri, diagnostics);
}

let timer: NodeJS.Timer;

export function subscribeToDocumentChanges(
  context: vscode.ExtensionContext,
  diagbostics: vscode.DiagnosticCollection
): void {
  if (vscode.window.activeTextEditor) {
    refreshDiagnostics(vscode.window.activeTextEditor.document, diagbostics);
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          refreshDiagnostics(editor.document, diagbostics);
        }, 200);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        refreshDiagnostics(e.document, diagbostics);
      }, 200);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) =>
      diagbostics.delete(doc.uri)
    )
  );
}
