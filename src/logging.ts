/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { Level, config } from './config';
import { Disposable, StateProvider } from './shared';

function isUri(obj: any): obj is vscode.Uri {
  if (typeof obj === 'object') {
    return "$mid" in obj;
  }
  return false;
}

type LogItemGetter = () => any;

class LogItem {
  private getter: LogItemGetter;
  private actual: any|undefined;
  private got: any|undefined;

  public constructor(getter: LogItemGetter, actual?: any) {
    this.getter = getter;
    this.actual = actual;
  }

  public getForOutput(): any {
    if (this.got) {
      return this.got;
    }

    return this.got = this.getter();
  }

  public getForConsole(): any {
    if (this.actual) {
      return this.actual;
    }

    return this.getForOutput();
  }
}

export function logItem(getter: LogItemGetter, actual?: any): LogItem {
  return new LogItem(getter, actual);
}

function serialize(value: any): string {
  if (value instanceof LogItem) {
    value = value.getForOutput();
  }

  if (value === null) {
    return '<null>';
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value instanceof Error) {
    return value.toString();
  }

  if (isUri(value)) {
    if (value.scheme === 'file') {
      return value.fsPath;
    }
    return value.toString();
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
      return JSON.stringify(value, null, '  ');
  }
}

class Logger implements Disposable {
  private name: string;
  private channel?: vscode.OutputChannel;

  public constructor(name: string) {
    this.name = name;
  }

  public dispose(): void {
    if (this.channel) {
      this.channel.dispose();
    }
  }

  private shouldOpen(level: Level): boolean {
    return level >= config.getLogShowLevel();
  }

  private shouldOutput(level: Level): boolean {
    return level >= config.getLogLevel();
  }

  private writeOutput(str: string, show: boolean): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(this.name);
    }
    this.channel.appendLine(str);
    if (show) {
      this.channel.show(true);
    }
  }

  private output(level: Level, ...args: any[]): void {
    let levelstr: string = Level[level];

    let consoleArgs: any[] = args.map((a) => a instanceof LogItem ? a.getForConsole() : a);

    switch (level) {
      case Level.Warn:
        console.warn(`mozillacpp ${levelstr}:`, ...consoleArgs);
        break;
      case Level.Error:
        console.error(`mozillacpp ${levelstr}:`, ...consoleArgs);
        break;
      default:
        console.log(`mozillacpp ${levelstr}:`, ...consoleArgs);
        break;
    }

    if (!this.shouldOutput(level)) {
      return;
    }

    this.writeOutput(`${levelstr}: ${args.map(serialize).join(' ')}`, this.shouldOpen(level));
  }

  public async dumpState(obj: StateProvider): Promise<void> {
    let state: any = await obj.toState();
    console.log('Current state', state);
    let str: string = JSON.stringify(state, (_key, value) => {
      if (isUri(value)) {
        return value.fsPath;
      }
      return value;
    }, 2);
    this.writeOutput(`Mozilla intellisense state: ${str}`, true);
  }

  public debug(...args: any[]): void {
    this.output(Level.Debug, ...args);
  }

  public log(...args: any[]): void {
    this.output(Level.Log, ...args);
  }

  public warn(...args: any[]): void {
    this.output(Level.Warn, ...args);
  }

  public error(...args: any[]): void {
    this.output(Level.Error, ...args);
  }
}

export let log: Logger = new Logger('Mozilla Intellisense');
