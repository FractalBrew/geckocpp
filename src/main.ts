/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { gWorkspace } from './workspace';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('mozillacpp.resetIntellisense', () => {
      gWorkspace.resetConfiguration();
      gWorkspace.resetBrowseConfiguration();
    })
  );
}

export function deactivate(): void {
  gWorkspace.dispose();
}
