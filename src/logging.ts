/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from "vscode";

import { Level, config } from "./config";
import { FilePath, Disposable, StateProvider } from "./shared";

type LogItemGetter = (level: Level) => string;

type Primitive = null | undefined | string | boolean | number | bigint | symbol | object;

function intoPrimitive(value: unknown): Primitive | Primitive[] {
  if (Array.isArray(value)) {
    return value.map((v: unknown): Primitive => intoPrimitive(v));
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Error) {
    return value.toString();
  }

  if (value instanceof FilePath) {
    return value.toPath();
  }

  switch (typeof value) {
    case "string":
    case "undefined":
    case "boolean":
    case "number":
    case "bigint":
    case "symbol":
      return value;
    default: {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let obj = value as any;
      let result: any = {};
      for (let key of Object.keys(obj)) {
        result[key] = intoPrimitive(obj[key]);
      }
      return result;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
  }
}

interface LogItemForOutput {
  getForOutput(level: Level): string;
}

function isForOutput(item: unknown): item is LogItemForOutput {
  return typeof item == "object" && item != null && "getForOutput" in item;
}

interface LogItemForConsole {
  getForConsole(): unknown;
}

function isForConsole(item: unknown): item is LogItemForConsole {
  return typeof item == "object" && item != null && "getForConsole" in item;
}

export type LogItem = LogItemForConsole & LogItemForOutput;

export abstract class LogItemImpl implements LogItem {
  public getForOutput(_level: Level): string {
    return String(this.getForConsole());
  }

  public getForConsole(): unknown {
    return this.getForOutput(Level.Debug);
  }
}

class WrappedLogItem extends LogItemImpl {
  private item: unknown;

  public constructor(item: unknown) {
    super();
    this.item = item;
  }

  public getForOutput(level: Level): string {
    if (this.item && typeof this.item === "object") {
      if (isForOutput(this.item)) {
        return this.item.getForOutput(level);
      }

      if (isForConsole(this.item)) {
        return String(this.item.getForConsole());
      }
    }

    let result = intoPrimitive(this.item);
    if (typeof result === "object") {
      return JSON.stringify(result, null, 2);
    }
    return String(result);
  }

  public getForConsole(): unknown {
    if (typeof this.item === "object") {
      if (isForConsole(this.item)) {
        return this.item.getForConsole();
      }

      if (isForOutput(this.item)) {
        return this.item.getForOutput(Level.Debug);
      }
    }

    return intoPrimitive(this.item);
  }
}

function asLogItem(item: unknown): LogItem {
  if (item instanceof LogItemImpl) {
    return item;
  }

  return new WrappedLogItem(item);
}

class ComposedLogItem extends LogItemImpl {
  private getter: LogItemGetter;
  private actual: unknown | undefined;
  private got: string | undefined;

  public constructor(getter: LogItemGetter, actual?: unknown) {
    super();
    this.getter = getter;
    this.actual = actual;
  }

  public getForOutput(level: Level): string {
    if (this.got) {
      return this.got;
    }

    return this.got = this.getter(level);
  }

  public getForConsole(): unknown {
    if (this.actual) {
      return this.actual;
    }

    return this.getForOutput(Level.Debug);
  }
}

export function logItem(getter: LogItemGetter, actual?: unknown): LogItem {
  return new ComposedLogItem(getter, actual);
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

  public writeOutput(show: boolean, str: string): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(this.name);
    }
    this.channel.appendLine(str);
    if (show) {
      this.channel.show(true);
    }
  }

  private output(level: Level, ...args: unknown[]): void {
    let levelstr: string = Level[level];
    let logItems: LogItem[] = args.map(asLogItem);

    let consoleArgs: unknown[] = logItems.map((l: LogItem): unknown => l.getForConsole());

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

    let outputLevel: Level = config.getLogLevel();

    let intoString = (a: LogItem): string => a.getForOutput(outputLevel);
    this.writeOutput(this.shouldOpen(level), `${levelstr}: ${logItems.map(intoString).join(" ")}`);
  }

  public async dumpState(obj: StateProvider): Promise<void> {
    let state: LogItem = asLogItem(await obj.toState());
    console.log("Current state", state.getForConsole());

    this.writeOutput(true, `Mozilla intellisense state: ${state.getForOutput(Level.Debug)}`);
  }

  public debug(...args: unknown[]): void {
    this.output(Level.Debug, ...args);
  }

  public log(...args: unknown[]): void {
    this.output(Level.Log, ...args);
  }

  public warn(...args: unknown[]): void {
    this.output(Level.Warn, ...args);
  }

  public error(...args: unknown[]): void {
    this.output(Level.Error, ...args);
  }
}

export let log: Logger = new Logger("Mozilla Intellisense");
