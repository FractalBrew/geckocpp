/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from "vscode";

import { SourceFolder, SourceFolderState } from "./folders";
import { log } from "./logging";
import { MachConfigurationProvider } from "./provider";
import { StateProvider, Disposable } from "./shared";

interface WorkspaceState {
  mozillaCount: number;
  folders: SourceFolderState[];
}

export class Workspace implements StateProvider, Disposable {
  private mozillaCount = 0;
  private folders: Map<vscode.Uri, Promise<SourceFolder>>;
  private provider: MachConfigurationProvider | null = null;

  public constructor() {
    this.folders = new Map();

    let folders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
    if (folders) {
      folders.forEach((f: vscode.WorkspaceFolder): void => {
        this.addFolder(f);
      });
    }

    let listener = (event: vscode.WorkspaceFoldersChangeEvent): void => {
      this.workspaceChanged(event);
    };
    vscode.workspace.onDidChangeWorkspaceFolders(listener);
  }

  public async toState(): Promise<WorkspaceState> {
    return {
      mozillaCount: this.mozillaCount,
      folders: await Promise.all((await Promise.all(this.folders.values()))
        .map((f: SourceFolder): Promise<SourceFolderState> => f.toState())),
    };
  }

  public dispose(): void {
    if (this.provider) {
      this.provider.dispose();
    }

    for (let folder of this.folders.values()) {
      folder.then((f: SourceFolder): void => f.dispose());
    }
    this.folders.clear();
  }

  private async rebuildFolder(oldFolder: SourceFolder): Promise<void> {
    let promise: Promise<SourceFolder> = SourceFolder.create(oldFolder.folder);
    this.folders.set(oldFolder.root, promise);
    let newFolder: SourceFolder = await promise;

    if (oldFolder.isMozillaSource() !== newFolder.isMozillaSource()) {
      if (oldFolder.isMozillaSource()) {
        this.mozillaCount--;
      } else {
        this.mozillaCount++;
      }
    }

    oldFolder.dispose();
  }

  public async rebuildFolders(folders: SourceFolder[]): Promise<void> {
    await Promise.all(folders.map((f: SourceFolder): Promise<void> => this.rebuildFolder(f)));

    if (this.mozillaCount > 0 && !this.provider) {
      this.provider = await MachConfigurationProvider.create(this);
    } else {
      this.resetBrowseConfiguration();
      this.resetConfiguration();
    }
  }

  private async addFolder(wFolder: vscode.WorkspaceFolder): Promise<void> {
    let promise: Promise<SourceFolder> = SourceFolder.create(wFolder);
    this.folders.set(wFolder.uri, promise);
    let folder: SourceFolder = await promise;

    if (folder.isMozillaSource()) {
      this.mozillaCount++;

      if (this.mozillaCount === 1) {
        this.provider = await MachConfigurationProvider.create(this);
      } else {
        this.resetConfiguration();
        this.resetBrowseConfiguration();
      }
    }
  }

  private async removeFolder(wFolder: vscode.WorkspaceFolder): Promise<void> {
    let promise: Promise<SourceFolder>| undefined = this.folders.get(wFolder.uri);
    if (!promise) {
      log.warn("Attempted to remove an unknown workspace folder.");
      return;
    }

    this.folders.delete(wFolder.uri);
    let folder: SourceFolder = await promise;
    if (folder.isMozillaSource()) {
      this.mozillaCount--;

      this.resetConfiguration();
      this.resetBrowseConfiguration();
    }
  }

  private workspaceChanged(event: vscode.WorkspaceFoldersChangeEvent): void {
    event.added.forEach((f: vscode.WorkspaceFolder): void => {
      this.addFolder(f);
    });
    event.removed.forEach((f: vscode.WorkspaceFolder): void => {
      this.removeFolder(f);
    });
  }

  public async getFolder(uri: vscode.Uri): Promise<SourceFolder | undefined> {
    let wFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(uri);
    if (wFolder) {
      return this.folders.get(wFolder.uri);
    }
    return undefined;
  }

  public async getAllFolders(): Promise<SourceFolder[]> {
    return Promise.all(this.folders.values());
  }

  public async getMozillaFolders(): Promise<SourceFolder[]> {
    return (await Promise.all(this.folders.values()))
      .filter((f: SourceFolder): boolean => f.isMozillaSource());
  }

  public canProvideConfig(): Promise<boolean> {
    return Promise.resolve(this.mozillaCount > 0);
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

export let workspace: Workspace = new Workspace();
