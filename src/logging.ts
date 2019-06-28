/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { Level, config } from './config';
import { Disposable, StateProvider } from './shared';

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

class Logger implements Disposable {
  name: string;
  channel?: vscode.OutputChannel;

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

  private writeOutput(str: string): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(this.name);
    }
    this.channel.appendLine(str);
  }

  private output(level: Level, ...args: any[]): void {
    let levelstr: string = Level[level];

    switch (level) {
      case Level.Warn:
        console.warn(`mozillacpp ${levelstr}:`, ...args);
        break;
      case Level.Error:
        console.error(`mozillacpp ${levelstr}:`, ...args);
        break;
      default:
        console.log(`mozillacpp ${levelstr}:`, ...args);
        break;
    }

    if (!this.shouldOutput(level)) {
      return;
    }

    this.writeOutput(`${levelstr}: ${args.map(serialize).join(' ')}`);

    if (this.shouldOpen(level) && this.channel) {
      this.channel.show(true);
    }
  }

  public async dumpState(obj: StateProvider): Promise<void> {
    let str: string = JSON.stringify(await obj.toState(), undefined, 2);
    this.writeOutput(str);

    if (this.channel) {
      this.channel.show(true);
    }
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
