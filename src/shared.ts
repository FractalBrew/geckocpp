/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { promises as fs, Stats } from "fs";
import * as path from "path";

import * as vscode from "vscode";

export interface Disposable {
  dispose(): void;
}

export interface StateProvider {
  toState(): Promise<unknown>;
}

abstract class TranslatedSet<B, R> {
  private set: Set<B>;
  private intoB: (item: R) => B;
  private intoR: (base: B) => R;

  protected constructor(intoB: (item: R) => B, intoR: (base: B) => R, from?: Iterable<R>) {
    this.intoB = intoB;
    this.intoR = intoR;

    this.set = new Set();

    if (from) {
      for (let path of from) {
        this.set.add(this.intoB(path));
      }
    }
  }

  public [Symbol.iterator](): Iterator<R> {
    return this.values();
  }

  public get size(): number {
    return this.set.size;
  }

  public add(item: R): this {
    this.set.add(this.intoB(item));
    return this;
  }

  public clear(): void {
    this.set.clear();
  }

  public delete(item: R): boolean {
    return this.set.delete(this.intoB(item));
  }

  public has(item: R): boolean {
    return this.set.has(this.intoB(item));
  }

  public *entries(): IterableIterator<[R, R]> {
    for (let item of this.values()) {
      yield [item, item];
    }
  }

  public keys(): IterableIterator<R> {
    return this.values();
  }

  public *values(): IterableIterator<R> {
    for (let base of this.set) {
      yield this.intoR(base);
    }
  }

  public forEach(callback: (value: R, key: R, set: TranslatedSet<B, R>) => void, thisArg: unknown):
  void {
    this.set.forEach((base: B): void => {
      let item: R = this.intoR(base);
      callback.call(thisArg, item, item, this);
    });
  }
}

export class FilePath {
  private path: string;

  private constructor(str: string) {
    if (!path.isAbsolute(str)) {
      throw new Error(`Attempting to parse '${str}' as an absolute path.`);
    }

    this.path = str;
  }

  public static fromPath(path: string): FilePath {
    return new FilePath(path);
  }

  public static fromUri(uri: vscode.Uri): FilePath {
    if (uri.scheme !== "file") {
      throw new Error(`Attempted to convert a non-file uri to a local path: ${uri}`);
    }
    return FilePath.fromPath(uri.fsPath);
  }

  public static fromUnixy(path: string): FilePath {
    if (process.platform === "win32") {
      return FilePath.fromPath(path.replace(/\//g, "\\"));
    }
    return FilePath.fromPath(path);
  }

  public equals(other: FilePath): boolean {
    return this.path === other.path;
  }

  public toUnixy(): string {
    if (process.platform === "win32") {
      return this.toPath().replace(/\\/g, "/");
    }
    return this.toPath();
  }

  public toPath(): string {
    return this.path;
  }

  public toUri(): vscode.Uri {
    return vscode.Uri.file(this.toPath());
  }

  public extname(): string {
    return path.extname(this.toPath());
  }

  public changeType(newType: string): FilePath {
    return FilePath.fromPath(`${this.toPath()}.${newType}`);
  }

  public parent(): FilePath {
    return FilePath.fromPath(path.dirname(this.toPath()));
  }

  public join(...args: string[]): FilePath {
    return FilePath.fromPath(path.join(this.toPath(), ...args));
  }

  public rebase(from: FilePath, to: FilePath): FilePath {
    let rel: string = path.relative(from.toPath(), this.toPath());
    return new FilePath(path.join(to.toPath(), rel));
  }

  public async stat(): Promise<Stats> {
    return fs.stat(this.toPath());
  }

  public async exists(): Promise<boolean> {
    try {
      await this.stat();
      return true;
    } catch (e) {
      return false;
    }
  }

  public async isDirectory(): Promise<boolean> {
    try {
      let stats: Stats = await this.stat();
      return stats.isDirectory();
    } catch (e) {
      return false;
    }
  }

  public async isFile(): Promise<boolean> {
    try {
      let stats: Stats = await this.stat();
      return stats.isFile();
    } catch (e) {
      return false;
    }
  }

  public toString(): string {
    return this.toPath();
  }
}

export class FilePathSet extends TranslatedSet<string, FilePath> {
  public constructor(from?: Iterable<FilePath>) {
    super(
      (path: FilePath): string => path.toPath(),
      (str: string): FilePath => FilePath.fromPath(str),
      from,
    );
  }
}
