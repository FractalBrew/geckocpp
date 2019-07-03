/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as path from 'path';
import { promises as fs, Stats } from 'fs';

import * as vscode from 'vscode';

import { Options } from 'split-string';
let split: (str: string, options: Options) => string[] = require('split-string');

export interface Disposable {
  dispose(): void;
}

export interface StateProvider {
  toState(): Promise<any>;
}

export class Path {
  private path: string;

  private constructor(str: string) {
    if (!path.isAbsolute(str)) {
      throw new Error(`Attempting to parse '${str}' as an absolute path.`);
    }

    this.path = str;
  }

  public static fromPath(path: string): Path {
    return new Path(path);
  }

  public static fromUri(uri: vscode.Uri): Path {
    if (uri.scheme !== 'file') {
      throw new Error(`Attempted to convert a non-file uri to a local path: ${uri}`);
    }
    return new Path(uri.fsPath);
  }

  public toPath(): string {
    return this.path;
  }

  public toUri(): vscode.Uri {
    return vscode.Uri.file(this.path);
  }

  public extname(): string {
    return path.extname(this.toPath());
  }

  public parent(): Path {
    return Path.fromPath(path.dirname(this.toPath()));
  }

  public join(...args: string[]): Path {
    return Path.fromPath(path.join(this.toPath(), ...args));
  }

  public rebase(from: Path, to: Path): Path {
    let rel: string = path.relative(from.toPath(), this.toPath());
    return new Path(path.join(to.toPath(), rel));
  }

  public async stat(): Promise<Stats> {
    return fs.stat(this.toPath());
  }

  public toString(): string {
    return this.toPath();
  }
}

export function splitCmdLine(cmdline: string): string[] {
  return split(cmdline.trim(), {
    quotes: true,
    separator: ' ',
  }).map((s: string): string => {
    if (s.length < 2) {
      return s;
    }

    if ((s.startsWith('\'') && s.endsWith('\'')) ||
        (s.startsWith('"') && s.endsWith('"'))) {
      return s.substring(1, s.length - 1);
    }

    return s;
  });
}

export function into(json: any, template: any): any {
  function error(message: string): void {
    throw new Error(`${message}: ${JSON.stringify(json)}`);
  }

  if (Array.isArray(template)) {
    if (json === undefined || json === null) {
      return [];
    }

    if (!Array.isArray(json)) {
      error('Unable to convert to an array.');
    }

    if (template.length !== 1) {
      error('Invalid template');
    }

    return json.map((v: any) => into(v, template[0]));
  }

  if ((typeof json) !== (typeof template)) {
    error('Type mismatch.');
  }

  if (typeof json === 'object') {
    let result: any = {};
    for (let key of Object.keys(template)) {
      result[key] = into(json[key], template[key]);
    }

    return result;
  } else {
    return json;
  }
}
