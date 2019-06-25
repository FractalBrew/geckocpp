import * as vscode from 'vscode';

import { WorkspaceFolder } from './folders';
import { MachConfigurationProvider } from './provider';

export class Workspace {
  machCount: number = 0;
  folders: Map<vscode.Uri, Promise<WorkspaceFolder>>;
  provider: MachConfigurationProvider|null = null;

  public constructor() {
    this.folders = new Map();

    let folders = vscode.workspace.workspaceFolders;
    if (folders) {
      folders.map((f) => this.addFolder(f));
    }

    vscode.workspace.onDidChangeWorkspaceFolders(() => this.workspaceChanged);
  }

  public dispose() {
    if (this.provider) {
      this.provider.dispose();
    }
  }

  private async addFolder(wFolder: vscode.WorkspaceFolder) {
    let promise = WorkspaceFolder.create(this, wFolder);
    this.folders.set(wFolder.uri, promise);
    let folder = await promise;

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

  private async removeFolder(wFolder: vscode.WorkspaceFolder) {
    let promise = this.folders.get(wFolder.uri);
    if (!promise) {
      console.warn('mozillacpp: Attempted to remove an unknown workspace folder.');
      return;
    }

    this.folders.delete(wFolder.uri);
    let folder = await promise;
    if (folder.hasMach()) {
      this.machCount--;

      this.resetConfiguration();
      this.resetBrowseConfiguration();
    }
  }

  private workspaceChanged(event: vscode.WorkspaceFoldersChangeEvent) {
    event.added.map((f) => this.addFolder(f));
    event.removed.map((f) => this.removeFolder(f));
  }

  public async getFolder(uri: vscode.Uri): Promise<WorkspaceFolder|undefined> {
    let wFolder = vscode.workspace.getWorkspaceFolder(uri);
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

  public resetConfiguration() {
    if (this.provider) {
      this.provider.resetConfiguration();
    }
  }

  public resetBrowseConfiguration() {
    if (this.provider) {
      this.provider.resetBrowseConfiguration();
    }
  }
}

export const gWorkspace = new Workspace();
