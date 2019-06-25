import * as vscode from 'vscode';

import { gWorkspace } from './workspace';

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mozillacpp.resetIntellisense', () => {
      gWorkspace.resetConfiguration();
      gWorkspace.resetBrowseConfiguration();
    })
  );
}

export function deactivate() {
  gWorkspace.dispose();
}
