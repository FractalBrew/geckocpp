import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';

const split = require('split-string');

import { log } from './logging';

export const CPP_VERSION = 'c++14';
export const C_VERSION = 'gnu99';

const FRAMEWORK_MARKER = ' (framework directory)';

export interface CompilerInfo {
  compiler: string;
  extension: string;
  frameworkIncludes: Set<string>;
  includes: Set<string>;
  defines: Set<string>;
}

export function splitCmdLine(cmdline: string): string[] {
  let stripQuotes = (s: string): string => {
    if (s.length < 2) {
      return s;
    }

    if ((s.startsWith('\'') && s.endsWith('\'')) ||
        (s.startsWith('"') && s.endsWith('"'))) {
      return s.substring(1, s.length - 1);
    }

    return s;
  };

  return split(cmdline.trim(), {
    quotes: true,
    separator: ' ',
  }).map(stripQuotes);
}

export function parseConfigFromCmdLine(compilerInfo: CompilerInfo, cmdline: string): cpptools.SourceFileConfiguration {
  let args = splitCmdLine(cmdline);

  let includePath: Set<string> = new Set(compilerInfo.includes);
  let defines: Set<string> = new Set(compilerInfo.defines);
  let forcedInclude: Set<string> = new Set();

  for (let path of compilerInfo.frameworkIncludes) {
    includePath.add(path);
  }

  let arg;
  while (arg = args.shift()) {
    if (arg.length < 2 || (arg.charAt(0) !== '-' && arg.charAt(0) !== '/')) {
      log.warn(`Skipping unknown argument: ${JSON.stringify(args)}`);
      continue;
    }

    switch (arg.charAt(1)) {
      case 'D':
        defines.add(arg.substring(2));
        continue;
      case 'I':
        includePath.add(arg.substring(2));
        continue;
    }

    if (arg === '-include') {
      let include = args.shift();
      if (include) {
        forcedInclude.add(include);
      }
      continue;
    }

    if (arg === '-isysroot') {
      args.shift();
    }
  }

  return {
    includePath: Array.from(includePath),
    defines: Array.from(defines),
    intelliSenseMode: 'clang-x64',
    standard: CPP_VERSION,
    forcedInclude: Array.from(forcedInclude),
  };
}

export function parseCompilerDefaults(info: CompilerInfo, output: string) {
  let lines = output.trim().split('\n');

  let inIncludes: boolean = false;
  for (let line of lines) {
    if (inIncludes) {
      if (line.charAt(0) === ' ') {
        let include = line.trim();
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
      let define = line.substring(8).trim();
      let pos = define.indexOf(" ");
      if (pos > 0) {
        define = `${define.substring(0, pos)}=${define.substring(pos).trim()}`;
      }
      info.defines.add(define);
    }
  }
}
