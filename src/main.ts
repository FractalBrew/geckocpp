/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { workspace } from './workspace';
import { config } from './config';
import { log } from './logging';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    config,
    log,
    workspace,
    vscode.commands.registerCommand('mozillacpp.resetIntellisense', () => {
      workspace.resetConfiguration();
      workspace.resetBrowseConfiguration();
    })
  );
}

export function deactivate(): void {
}
