/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { SourceFolder } from './folders';
import { workspace } from './workspace';
import { StateProvider, Disposable } from './shared';

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
  listener: vscode.Disposable;
  logLevel: Level = DEFAULT_LOG_LEVEL;
  showLogLevel: Level = DEFAULT_LOG_SHOW_LEVEL;

  constructor() {
    this.listener = vscode.workspace.onDidChangeConfiguration((e) => this.onConfigChange(e));
    this.fetchLogConfig();
  }

  async toState(): Promise<any> {
    return {
      logLevel: this.logLevel,
      showLogLevel: this.showLogLevel,
    };
  }

  dispose(): void {
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

    if (event.affectsConfiguration('mozillacpp.tag')) {
      workspace.resetBrowseConfiguration();
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

  public getCompiler(folder: vscode.Uri, extension: string): string|undefined {
    return this.getRoot(folder).get(`compiler.${extension}.path`) || undefined;
  }

  public getMach(folder: vscode.Uri): string|undefined {
    return this.getRoot(folder).get('mach.path') || undefined;
  }

  public getMachEnvironment(folder: vscode.Uri): NodeJS.ProcessEnv {
    return Object.assign({}, this.getRoot(folder).get('mach.environment') || {}, process.env);
  }

  public getLogLevel(): Level {
    return this.logLevel;
  }

  public getLogShowLevel(): Level {
    return this.showLogLevel;
  }

  public isTagParsingDisable(): boolean {
    return this.getRoot().get('tag.disabled') || false;
  }
}

export let config: Configuration = new Configuration();
