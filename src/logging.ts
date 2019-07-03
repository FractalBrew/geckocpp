/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { Level, config } from './config';
import { Path, Disposable, StateProvider } from './shared';

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

function intoPrimitive(value: any): any {
  if (Array.isArray(value)) {
    return value.map(intoPrimitive);
  }

  if (value instanceof LogItem) {
    value = value.getForOutput();
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Error) {
    return value.toString();
  }

  if (value instanceof Path) {
    return value.toPath();
  }

  switch (typeof value) {
    case 'string':
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'symbol':
      return value;
    default:
      let result: any = {};
      for (let key of Object.keys(value)) {
        result[key] = intoPrimitive(value[key]);
      }
      return result;
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

    this.writeOutput(`${levelstr}: ${args.map((a) => JSON.stringify(intoPrimitive(a), null, '  ')).join(' ')}`, this.shouldOpen(level));
  }

  public async dumpState(obj: StateProvider): Promise<void> {
    let state: any = await obj.toState();
    console.log('Current state', state);

    let str: string = JSON.stringify(intoPrimitive(state), null, 2);
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
