/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

enum Level {
  Never = 0,
  Debug,
  Log,
  Warn,
  Error,
}

function levelFromStr(name: string): Level {
  switch (name.toLocaleLowerCase()) {
    case 'debug':
      return Level.Debug;
    case 'log':
      return Level.Log;
    case 'warn':
      return Level.Warn;
    case 'error':
      return Level.Error;
    default:
      return Level.Never;
  }
}

function serialize(value: any): string {
  if (value === null) {
    return '<null>';
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  switch (typeof value) {
    case 'string':
      return value;
    case 'undefined':
      return '<undefined>';
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'symbol':
      return String(value);
    case 'function':
      let args: string = '';

      if (value.length > 0) {
        let ch: string = 'a';
        args = ch;
        for (let i: number = 1; i < value.length; i++) {
          ch = String.fromCharCode(ch.charCodeAt(0) + 1);
          args += `, ${ch}`;
        }
      }

      return `function ${value.name}(${args}) {}`;
    default:
      return JSON.stringify(value);
  }
}

class Logger {
  channel: vscode.OutputChannel;
  logLevel: Level = Level.Warn;
  showLevel: Level = Level.Never;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);

    this.updateConfig();
    vscode.workspace.onDidChangeConfiguration(() => this.updateConfig());
  }

  updateConfig(): void {
    let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('mozillacpp');
    this.logLevel = levelFromStr(config.get('log_level', 'warn'));
    this.showLevel = levelFromStr(config.get('log_show_level', 'never'));
  }

  shouldOpen(level: Level): boolean {
    return level >= this.showLevel;
  }

  shouldOutput(level: Level): boolean {
    return level >= this.logLevel;
  }

  output(level: Level, ...args: any[]): void {
    switch (level) {
      case Level.Debug:
        console.debug('mozillacpp:', ...args);
        break;
      case Level.Warn:
        console.warn('mozillacpp:', ...args);
        break;
      case Level.Error:
        console.error('mozillacpp:', ...args);
        break;
      default:
        console.log('mozillacpp:', ...args);
        break;
    }

    if (!this.shouldOutput(level)) {
      return;
    }

    this.channel.appendLine(args.map(serialize).join(' '));

    if (this.shouldOpen(level)) {
      this.channel.show(true);
    }
  }

  debug(...args: any[]): void {
    this.output(Level.Debug, ...args);
  }

  log(...args: any[]): void {
    this.output(Level.Log, ...args);
  }

  warn(...args: any[]): void {
    this.output(Level.Warn, ...args);
  }

  error(...args: any[]): void {
    this.output(Level.Error, ...args);
  }
}

export let log: Logger = new Logger("Mozilla Intellisense");
