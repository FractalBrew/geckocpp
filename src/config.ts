/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { promises as fs, Stats } from 'fs';

import * as vscode from 'vscode';

import { SourceFolder } from './folders';
import { workspace } from './workspace';
import { FilePath, StateProvider, Disposable, splitCmdLine } from './shared';
import { CmdArgs } from './exec';
import { FileType } from './compiler';

export enum Level {
  Always = 0,
  Debug,
  Log,
  Warn,
  Error,
  Never,
}

const DEFAULT_LOG_LEVEL: Level = Level.Warn;
const DEFAULT_LOG_SHOW_LEVEL: Level = Level.Never;

async function asCmdArgs(cmdLine: string): Promise<CmdArgs> {
  async function isPath(arg: string): Promise<boolean> {
    try {
      let stat: Stats = await fs.stat(arg);
      return stat.isFile();
    } catch (e) {
      return false;
    }
  }

  async function fixup(arg: string): Promise<string|FilePath> {
    if (await isPath(arg)) {
      return FilePath.fromPath(arg);
    }
    return arg;
  }

  return Promise.all(splitCmdLine(cmdLine).map(fixup));
}

function levelFromStr(name: string|undefined, normal: Level): Level {
  if (!name) {
    return normal;
  }

  switch (name.toLocaleLowerCase()) {
    case 'always':
      return Level.Always;
    case 'debug':
      return Level.Debug;
    case 'log':
      return Level.Log;
    case 'warn':
      return Level.Warn;
    case 'error':
      return Level.Error;
    case 'never':
      return Level.Never;
    default:
      return normal;
  }
}

class Configuration implements StateProvider, Disposable {
  private listener: vscode.Disposable;
  private logLevel: Level = DEFAULT_LOG_LEVEL;
  private showLogLevel: Level = DEFAULT_LOG_SHOW_LEVEL;

  public constructor() {
    this.listener = vscode.workspace.onDidChangeConfiguration((e) => this.onConfigChange(e));
    this.fetchLogConfig();
  }

  public async toState(): Promise<any> {
    return {
      logLevel: this.logLevel,
      showLogLevel: this.showLogLevel,
    };
  }

  public dispose(): void {
    this.listener.dispose();
  }

  private fetchLogConfig(): void {
    this.logLevel = levelFromStr(this.getRoot().get('log.level'), DEFAULT_LOG_LEVEL);
    this.showLogLevel = levelFromStr(this.getRoot().get('log.show_level'), DEFAULT_LOG_SHOW_LEVEL);
  }

  private async onConfigChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!event.affectsConfiguration('mozillacpp')) {
      return;
    }

    if (event.affectsConfiguration('mozillacpp.log')) {
      this.fetchLogConfig();
    }

    let folders: SourceFolder[] = await workspace.getAllFolders();
    let rebuilds: SourceFolder[] = [];
    for (let folder of folders) {
      if (event.affectsConfiguration('mozillacpp.compiler', folder.root) ||
          event.affectsConfiguration('mozillacpp.mach', folder.root)) {
        rebuilds.push(folder);
      }
    }

    workspace.rebuildFolders(rebuilds);
  }

  private getRoot(uri?: vscode.Uri): vscode.WorkspaceConfiguration {
    if (uri) {
      return vscode.workspace.getConfiguration('mozillacpp', uri);
    } else {
      return vscode.workspace.getConfiguration('mozillacpp');
    }
  }

  public async getCompiler(folder: vscode.Uri, type: FileType): Promise<CmdArgs|undefined> {
    let compiler: string|undefined = this.getRoot(folder).get(`compiler.${type}.path`);
    if (compiler) {
      return asCmdArgs(compiler);
    }
    return undefined;
  }

  public async getMach(folder: vscode.Uri): Promise<CmdArgs|undefined> {
    let mach: string|undefined = this.getRoot(folder).get('mach.path');
    if (mach) {
      return asCmdArgs(mach);
    }
    return undefined;
  }

  public getMachEnvironment(folder: vscode.Uri): NodeJS.ProcessEnv {
    return Object.assign({}, this.getRoot(folder).get('mach.environment') || {}, process.env);
  }

  public getMozillaBuild(): FilePath {
    return FilePath.fromPath(this.getRoot().get('mozillabuild') || 'C:\\mozilla-build');
  }

  public getLogLevel(): Level {
    return this.logLevel;
  }

  public getLogShowLevel(): Level {
    return this.showLogLevel;
  }
}

export let config: Configuration = new Configuration();
