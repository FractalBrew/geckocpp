/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { Build } from './build';
import { FilePath, Disposable, StateProvider, FilePathSet } from './shared';
import { SourceFileConfiguration } from 'vscode-cpptools';

export class SourceFolder implements StateProvider, Disposable {
  public readonly folder: vscode.WorkspaceFolder;
  private build: Build|undefined;

  public get root(): vscode.Uri {
    return this.folder.uri;
  }

  public static async create(folder: vscode.WorkspaceFolder): Promise<SourceFolder> {
    return new SourceFolder(folder, await Build.create(folder.uri));
  }

  private constructor(folder: vscode.WorkspaceFolder, build: Build|undefined) {
    this.folder = folder;
    this.build = build;
  }

  public async toState(): Promise<any> {
    return {
      root: this.folder.uri.toString(),
      build: this.build ? await this.build.toState() : null,
    };
  }

  public dispose(): void {
  }

  public isMozillaSource(): boolean {
    return this.build !== undefined;
  }

  public getTopSrcDir(): vscode.Uri {
    return this.folder.uri;
  }

  public getTopObjDir(): vscode.Uri {
    return this.build ? this.build.getObjDir().toUri() : this.folder.uri;
  }

  public getIncludePaths(): FilePathSet {
    if (!this.build) {
      return new FilePathSet();
    }

    return this.build.getIncludePaths();
  }

  public async getSourceConfiguration(uri: vscode.Uri): Promise<SourceFileConfiguration|undefined> {
    if (!this.build) {
      return Promise.resolve(undefined);
    }

    return this.build.getSourceConfiguration(FilePath.fromUri(uri));
  }

  public async testCompile(uri: vscode.Uri): Promise<void> {
    if (!this.build) {
      return;
    }

    return this.build.testCompile(FilePath.fromUri(uri));
  }

}
