/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { WorkspaceFolder } from './folders';
import { MachConfigurationProvider } from './provider';
import { log } from './logging';

export class Workspace {
  machCount: number = 0;
  folders: Map<vscode.Uri, Promise<WorkspaceFolder>>;
  provider: MachConfigurationProvider|null = null;

  public constructor() {
    this.folders = new Map();

    let folders: vscode.WorkspaceFolder[]|undefined = vscode.workspace.workspaceFolders;
    if (folders) {
      folders.map((f) => this.addFolder(f));
    }

    vscode.workspace.onDidChangeWorkspaceFolders(() => this.workspaceChanged);
  }

  public dispose(): void {
    if (this.provider) {
      this.provider.dispose();
    }
  }

  private async addFolder(wFolder: vscode.WorkspaceFolder): Promise<void> {
    let promise: Promise<WorkspaceFolder> = WorkspaceFolder.create(this, wFolder);
    this.folders.set(wFolder.uri, promise);
    let folder: WorkspaceFolder = await promise;

    if (folder.hasMach()) {
      this.machCount++;

      if (this.machCount === 1) {
        this.provider = await MachConfigurationProvider.create(this);
      } else {
        this.resetConfiguration();
        this.resetBrowseConfiguration();
      }
    }
  }

  private async removeFolder(wFolder: vscode.WorkspaceFolder): Promise<void> {
    let promise: Promise<WorkspaceFolder>|undefined = this.folders.get(wFolder.uri);
    if (!promise) {
      log.warn('Attempted to remove an unknown workspace folder.');
      return;
    }

    this.folders.delete(wFolder.uri);
    let folder: WorkspaceFolder = await promise;
    if (folder.hasMach()) {
      this.machCount--;

      this.resetConfiguration();
      this.resetBrowseConfiguration();
    }
  }

  private workspaceChanged(event: vscode.WorkspaceFoldersChangeEvent): void {
    event.added.map((f) => this.addFolder(f));
    event.removed.map((f) => this.removeFolder(f));
  }

  public async getFolder(uri: vscode.Uri): Promise<WorkspaceFolder|undefined> {
    let wFolder: vscode.WorkspaceFolder|undefined = vscode.workspace.getWorkspaceFolder(uri);
    if (wFolder) {
      return this.folders.get(wFolder.uri);
    }
    return undefined;
  }

  public async getMachFolders(): Promise<WorkspaceFolder[]> {
    return (await Promise.all(this.folders.values())).filter((f) => f.hasMach());
  }

  public async canProvideConfig(): Promise<boolean> {
    return this.machCount > 0;
  }

  public resetConfiguration(): void {
    if (this.provider) {
      this.provider.resetConfiguration();
    }
  }

  public resetBrowseConfiguration(): void {
    if (this.provider) {
      this.provider.resetBrowseConfiguration();
    }
  }
}

export let gWorkspace: Workspace = new Workspace();
