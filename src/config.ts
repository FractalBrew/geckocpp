/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

export enum Level {
  Always = 0,
  Debug,
  Log,
  Warn,
  Error,
  Never,
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

class Configuration {
  root: vscode.WorkspaceConfiguration;

  constructor() {
    this.root = vscode.workspace.getConfiguration('mozillacpp');
  }

  private getRoot(uri?: vscode.Uri): vscode.WorkspaceConfiguration {
    if (uri) {
      return vscode.workspace.getConfiguration('mozillacpp', uri);
    } else {
      return this.root;
    }
  }

  public getCompiler(folder: vscode.Uri, extension: string): string|undefined {
    return this.getRoot(folder).get(`${extension}.compiler`) || undefined;
  }

  public getMach(folder: vscode.Uri): string|undefined {
    return this.getRoot(folder).get('mach.path') || undefined;
  }

  public getMachEnvironment(folder: vscode.Uri): NodeJS.ProcessEnv {
    return Object.assign({}, this.getRoot(folder).get('mach.environment') || {}, process.env);
  }

  public getLogLevel(): Level {
    return levelFromStr(this.getRoot().get('log.level'), Level.Warn);
  }

  public getLogShowLevel(): Level {
    return levelFromStr(this.getRoot().get('log.show_level'), Level.Never);
  }

  public isTagParsingDisable(): boolean {
    return this.getRoot().get('tag.disabled') || false;
  }
}

export let config: Configuration = new Configuration();
