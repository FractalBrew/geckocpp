/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';

import * as vscode from 'vscode';

import { log } from './logging';
import { config } from './config';

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  public command: string|undefined;
  public result: ProcessResult|undefined;

  public constructor(message: string, command?: string, result?: ProcessResult) {
    super(message);
    this.command = command;
    this.result = result;
  }
}

export type CmdArgs = (string|vscode.Uri)[];
type Exec = (args: CmdArgs, cwd?: vscode.Uri, env?: NodeJS.ProcessEnv) => Promise<ProcessResult>;

function baseExec(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
  log.debug(`Executing '${command} ${args.join(' ')}'`);
  return new Promise((resolve, reject) => {
    let output: ProcessResult = {
      code: 0,
      stdout: '',
      stderr: '',
    };

    let childProcess: ChildProcess = spawn(command, args, {
      cwd,
      env: env || process.env,
      windowsHide: true,
      shell: false,
    });

    childProcess.stdout.on('data', (data) => {
      output.stdout += data;
    });

    childProcess.stderr.on('data', (data) => {
      output.stderr += data;
    });

    childProcess.on('error', () => {
      output.code = -1;
      reject(new ProcessError(`Failed to execute ${command}`, `${command} ${args.join(' ')}`, output));
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        output.code = code;
        log.warn(`Executing '${command} ${args.join(' ')}' failed with code ${code}`);
        reject(new ProcessError(`Failed to execute '${command}'`, `${command} ${args.join(' ')}`, output));
      }
    });
  });
}

let spawnExec: Exec = (args: CmdArgs, cwd?: vscode.Uri, env?: NodeJS.ProcessEnv): Promise<ProcessResult> => {
  function convertArg(arg: string|vscode.Uri): string {
    if (arg instanceof vscode.Uri) {
      return arg.fsPath;
    }

    return arg;
  }

  let cmdArgs: string[] = args.map(convertArg);
  let command: string|undefined = cmdArgs.shift();

  if (command) {
    return baseExec(command, cmdArgs, cwd ? cwd.fsPath : undefined, env);
  }
  throw new ProcessError('Invalid arguments passed to SpawnExec (no command).');
};

let mozillaBuildExec: Exec = async (args: CmdArgs, cwd?: vscode.Uri, env?: NodeJS.ProcessEnv): Promise<ProcessResult> => {
  function convertFile(name: string): string {
    // TODO convert name.
    return name;
  }

  function convertArg(arg: string|vscode.Uri): string {
    if (arg instanceof vscode.Uri) {
      return convertFile(arg.fsPath);
    }

    return arg;
  }

  function fixOutput(result: ProcessResult): void {
    if (result.stdout.startsWith('MozillaBuild Install Directory:')) {
      let pos: number = result.stdout.indexOf('\n');
      result.stdout = result.stdout.substring(pos);
    }
  }

  let mozillaBuild: string = config.getMozillaBuild().fsPath;
  env = Object.assign({
    MOZILLABUILD: mozillaBuild,
  }, env);

  // TODO this is wrong.
  let cmdArgs: string[] = args.map(convertArg);
  cmdArgs.unshift('--login', '-i', '-c');
  let command: string = path.join(mozillaBuild, 'msys', 'bin', 'bash.exe');

  try {
    let result: ProcessResult = await baseExec(command, cmdArgs, cwd ? cwd.fsPath : undefined, env);
    fixOutput(result);
    return result;
  } catch (e) {
    fixOutput(e.result);
    throw e;
  }
};

export let exec: Exec = (args: CmdArgs, cwd?: vscode.Uri, env?: NodeJS.ProcessEnv): Promise<ProcessResult> => {
  let internal: Exec = process.platform === 'win32' ? mozillaBuildExec : spawnExec;
  return internal(args, cwd, env);
};
