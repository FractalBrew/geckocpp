/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { workspace } from './workspace';
import { config } from './config';
import { log } from './logging';
import { SourceFolder } from './folders';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    config,
    log,
    workspace,
    vscode.commands.registerCommand('mozillacpp.resetIntellisense', () => {
      workspace.resetConfiguration();
      workspace.resetBrowseConfiguration();
    }),
    vscode.commands.registerCommand('mozillacpp.dumpState', () => {
      log.dumpState(workspace);
    }),
    vscode.commands.registerCommand('mozillacpp.testCompile', async () => {
      let editor: vscode.TextEditor|undefined = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      let folder: SourceFolder|undefined = await workspace.getFolder(editor.document.uri);
      if (!folder || !folder.isMozillaSource()) {
        return;
      }

      folder.testCompile(editor.document.uri);
    }),
  );
}

export function deactivate(): void {
}
