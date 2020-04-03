/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from "vscode";

import { config } from "./config";
import { SourceFolder } from "./folders";
import { log } from "./logging";
import { workspace } from "./workspace";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    config,
    log,
    workspace,
    vscode.commands.registerCommand("mozillacpp.resetIntellisense", (): void => {
      workspace.resetConfiguration();
      workspace.resetBrowseConfiguration();
    }),
    vscode.commands.registerCommand("mozillacpp.dumpState", (): void => {
      log.dumpState(workspace);
    }),
    vscode.commands.registerCommand("mozillacpp.testCompile", async(): Promise<void> => {
      let editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      let folder: SourceFolder | undefined = await workspace.getFolder(editor.document.uri);
      if (!folder || !folder.isMozillaSource()) {
        return;
      }

      folder.testCompile(editor.document.uri);
    }),
  );
}

export function deactivate(): void {
  // Nothing to do.
}
