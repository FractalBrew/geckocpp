/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as cpptools from 'vscode-cpptools';

import { Options } from 'split-string';
let split: (str: string, options: Options) => string[] = require('split-string');

import { log } from './logging';

export type VERSIONS = 'c89' | 'c99' | 'c11' | 'c++98' | 'c++03' | 'c++11' | 'c++14' | 'c++17';

export const CPP_STANDARD: VERSIONS = 'c++14';
export const CPP_VERSION: string = CPP_STANDARD;
export const C_STANDARD: VERSIONS = 'c99';
export const C_VERSION: string = 'gnu99';

const FRAMEWORK_MARKER: string = ' (framework directory)';

export interface Disposable {
  dispose(): void;
}

export interface StateProvider {
  toState(): Promise<any>;
}

interface Define {
  key: string;
  value: string;
}

export interface CompilerInfo {
  compiler: string;
  extension: string;
  standard: VERSIONS;
  frameworkIncludes: Set<string>;
  includes: Set<string>;
  defines: Map<string, Define>;
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

function buildDefine(text: string, splitter: string): Define {
  let pos: number = text.indexOf(splitter);
  if (pos >= 0) {
    return {
      key: text.substring(0, pos),
      value: text.substring(pos + 1),
    };
  }

  return {
    key: text,
    value: '1',
  };
}

function outputDefine(define: Define): string {
  return `${define.key}=${define.value}`;
}

export function parseConfigFromCmdLine(compilerInfo: CompilerInfo, cmdline: string): cpptools.SourceFileConfiguration {
  let args: string[] = splitCmdLine(cmdline);

  let includePath: Set<string> = new Set(compilerInfo.includes);
  let defines: Map<string, Define> = new Map(compilerInfo.defines);
  let forcedInclude: Set<string> = new Set();

  for (let path of compilerInfo.frameworkIncludes) {
    includePath.add(path);
  }

  let arg: string|undefined;
  while (arg = args.shift()) {
    if (arg.length < 2 || (arg.charAt(0) !== '-' && arg.charAt(0) !== '/')) {
      log.warn(`Skipping unknown argument: ${JSON.stringify(args)}`);
      continue;
    }

    switch (arg.charAt(1)) {
      case 'D':
        let define: Define = buildDefine(arg.substring(2), '=');
        defines.set(define.key, define);
        continue;
      case 'I':
        includePath.add(arg.substring(2));
        continue;
    }

    if (arg === '-include') {
      let include: string|undefined = args.shift();
      if (include) {
        forcedInclude.add(include);
      }
      continue;
    }

    if (arg === '-isysroot') {
      args.shift();
    }
  }

  let config: cpptools.SourceFileConfiguration = {
    includePath: Array.from(includePath),
    defines: Array.from(defines.values()).map(outputDefine),
    intelliSenseMode: 'clang-x64',
    standard: compilerInfo.standard,
    forcedInclude: Array.from(forcedInclude),
  };

  return config;
}

export function parseCompilerDefaults(info: CompilerInfo, output: string): void {
  let lines: string[] = output.trim().split('\n');

  let inIncludes: boolean = false;
  for (let line of lines) {
    if (inIncludes) {
      if (line.charAt(0) === ' ') {
        let include: string = line.trim();
        if (include.endsWith(FRAMEWORK_MARKER)) {
          info.frameworkIncludes.add(include.substring(0, include.length - FRAMEWORK_MARKER.length));
        } else {
          info.includes.add(include);
        }
        continue;
      } else {
        inIncludes = false;
      }
    }

    if (line.startsWith('#include ')) {
      inIncludes = true;
    } else if (line.startsWith('#define ')) {
      let define: Define = buildDefine(line.substring(8).trim(), ' ');
      info.defines.set(define.key, define);
    }
  }
}
