/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { FilePath } from './shared';
import { CmdArgs } from './exec';

export type PathFromArg = (arg: string) => FilePath|string;

export function shellParse(cmdLine: string, pathConvert?: PathFromArg): CmdArgs {
  let results: CmdArgs = [];
  function push(str: string): void {
    if (pathConvert) {
      results.push(pathConvert(str));
    } else {
      results.push(str);
    }
  }

  let singleFinder: RegExp = /^((?:.|\\\'))*'/;
  let doubleFinder: RegExp = /^((?:.|\\\"))*"/;
  let endFinder: RegExp = /^((?:\S|\\\ ))* /;
  let nextFinder: RegExp = /^\s*(\S)/;

  while (cmdLine.length) {
    let result: RegExpExecArray|null = nextFinder.exec(cmdLine);
    if (!result) {
      break;
    }

    if (result[1] === '"' || result[1] === '\'') {
      cmdLine = cmdLine.substring(result[0].length);
    } else {
      cmdLine = cmdLine.substring(result[0].length - 1);
    }

    result = (result[1] === '"' ? doubleFinder : (result[1] === '\'' ? singleFinder : endFinder)).exec(cmdLine);
    if (!result) {
      push(cmdLine);
      break;
    }

    push(cmdLine.substring(0, result[1].length));
    cmdLine = cmdLine.substring(result[0].length);
  }

  return results;
}

export type PathToArg = (path: FilePath) => string;

export function shellQuote(args: CmdArgs, pathConvert?: PathToArg): string {
  return args.map((a) => {
    if (a instanceof FilePath) {
      if (pathConvert) {
        return pathConvert(a);
      }
      return a.toPath();
    }
    return a;
  }).join(' ');
}
