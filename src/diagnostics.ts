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
  const indenter = new EraBasicIndenter(null);
  let diagnostics: vscode.Diagnostic[] = [];

  for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
    const lineOfText = doc.lineAt(lineIndex);
    indenter.resolve(lineOfText);
  }

  indenter.blocks.clear();
  if (indenter.blocks.error.length > 0) {
    diagnostics.push(...indenter.blocks.error);
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
