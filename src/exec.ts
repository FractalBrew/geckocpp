/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ChildProcess, spawn } from 'child_process';

import { log, LogItem, LogItemImpl } from './logging';
import { config, Level } from './config';
import { FilePath } from './shared';
import { bashShellQuote } from './shell';

function lineSplit(data: string): string[] {
  let results: string[] = [];
  let lineStart: number = 0;

  let i: number = 0;
  while (i < data.length) {
    if (data.charAt(i) === '\n') {
      results.push(data.substring(lineStart, i + 1));
      lineStart = i + 1;
    }

    i++;
  }

  if (lineStart < data.length) {
    results.push(data.substring(lineStart));
  }

  return results;
}

enum Pipe {
  StdOut,
  StdErr,
}

interface ProcessOutput {
  pipe: Pipe;
  data: string;
}

export class ProcessResult extends LogItemImpl {
  private command: string;
  private args: string[];
  private processExitCode: number;
  private processOutput: ProcessOutput[];
  private processError?: Error;

  private constructor(command: string, args: string[]) {
    super();
    this.command = command,
    this.args = args,
    this.processExitCode = 0;
    this.processOutput = [];
  }

  private addOutput(pipe: Pipe, data: string): void {
    if (!data) {
      return;
    }

    this.processOutput.push({ pipe, data });
  }

  public static async waitFor(command: string, args: string[], childProcess: ChildProcess): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      let result: ProcessResult = new ProcessResult(command, args);
      log.debug(`Executing '${result.printableCommand()}'`);
      let seenError: boolean = false;

      if (childProcess.stdout) {
        childProcess.stdout.setEncoding('utf8');
        childProcess.stdout.on('data', (data) => {
          if (seenError) {
            return;
          }

          result.addOutput(Pipe.StdOut, data);
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.setEncoding('utf8');
        childProcess.stderr.on('data', (data) => {
          if (seenError) {
            return;
          }

          result.addOutput(Pipe.StdErr, data);
        });
      }

      childProcess.on('error', (err: Error) => {
        seenError = true;
        result.processExitCode = -1;
        result.processError = err;
        reject(new ProcessError(result));
      });

      childProcess.on('close', (code) => {
        if (seenError) {
          return;
        }

        if (code === 0) {
          resolve(result);
        } else {
          result.processExitCode = code;
          reject(new ProcessError(result));
        }
      });
    });
  }

  private combineParts(parts: ProcessOutput[]): string[] {
    return lineSplit(parts.reduce((value: string, current: ProcessOutput) => {
      return value + current.data;
    }, ''));
  }

  public printableCommand(): string {
    if (this.args.length > 10) {
      return `${this.command} ${this.args.slice(0, 9).join(' ')} ...`;
    }
    return `${this.command} ${this.args.join(' ')}`;
  }

  public removeSubstring(pipe: Pipe, start: number, end: number): void {
    let i: number = 0;
    while (i < this.processOutput.length && start >= 0 && end >= 0) {
      let output: ProcessOutput = this.processOutput[i];
      if (output.pipe !== pipe) {
        i++;
        continue;
      }

      let dataLen: number = output.data.length;

      if (start < output.data.length) {
        output.data = output.data.substring(0, start) + output.data.substring(end);
        start = Math.max(0, start - dataLen);
        end -= dataLen;

        if (output.data.length === 0) {
          this.processOutput.splice(i, 1);
          continue;
        }
      }

      i++;
    }
  }

  public get exitCode(): number {
    return this.processExitCode;
  }

  public get stderr(): string[] {
    return this.combineParts(this.processOutput.filter((o) => o.pipe === Pipe.StdErr));
  }

  public get stdout(): string[] {
    return this.combineParts(this.processOutput.filter((o) => o.pipe === Pipe.StdOut));
  }

  public get output(): string[] {
    return this.combineParts(this.processOutput);
  }

  public getForOutput(level: Level): string {
    let output: string = '';
    if (this.processError) {
      output += `Execution of ${this.printableCommand()} failed: ${this.processError.message}.`;
    } else {
      output += `Execution of ${this.printableCommand()} finished with exit code ${this.exitCode}.`;
    }

    if (level <= Level.Log) {
      output += `\n${this.output.join('')}`;
    }

    return output;
  }

  public getForConsole(): any {
    return {
      command: this.printableCommand(),
      exitCode: this.exitCode,
      stdout: this.stdout.map((s) => s.trimRight()),
      stderr: this.stderr.map((s) => s.trimRight()),
    };
  }
}

export class ProcessError extends Error implements LogItem {
  public result: ProcessResult;

  public constructor(result: ProcessResult) {
    super();
    this.result = result;
  }

  public get message(): string {
    return this.result.getForOutput(Level.Warn);
  }

  public getForOutput(level: Level): any {
    return this.result.getForOutput(level);
  }

  public getForConsole(): any {
    return this.result.getForConsole();
  }
}

export type CmdArgs = (string|FilePath)[];
type Exec = (args: CmdArgs, cwd?: FilePath, env?: NodeJS.ProcessEnv) => Promise<ProcessResult>;

function baseExec(command: string, args: string[], cwd?: FilePath, env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return ProcessResult.waitFor(command, args, spawn(command, args, {
    cwd: cwd ? cwd.toPath() : undefined,
    env: env || process.env,
    windowsHide: true,
    shell: false,
  }));
}

let spawnExec: Exec = (args: CmdArgs, cwd?: FilePath, env?: NodeJS.ProcessEnv): Promise<ProcessResult> => {
  function convertArg(arg: string|FilePath): string {
    if (arg instanceof FilePath) {
      return arg.toPath();
    }

    return arg;
  }

  let cmdArgs: string[] = args.map(convertArg);
  let command: string|undefined = cmdArgs.shift();

  if (command) {
    return baseExec(command, cmdArgs, cwd, env);
  }
  throw new Error('Invalid arguments passed to SpawnExec (no command).');
};

let mozillaBuildExec: Exec = async (args: CmdArgs, cwd?: FilePath, env?: NodeJS.ProcessEnv): Promise<ProcessResult> => {
  function fixOutput(result: ProcessResult): void {
    let start: string = result.stdout[0];
    if (start.startsWith('MozillaBuild Install Directory:')) {
      result.removeSubstring(Pipe.StdOut, 0, start.length);
    }
  }

  let mozillaBuild: FilePath = config.getMozillaBuild();
  env = Object.assign({
    MOZILLABUILD: mozillaBuild.toPath() + '\\',
  }, env);

  let shellCmd: string = bashShellQuote(args.map((part) => {
    if (part instanceof FilePath) {
      return part.toUnixy();
    }
    return part;
  }));
  let command: string = mozillaBuild.join('msys', 'bin', 'bash.exe').toPath();

  try {
    let result: ProcessResult = await baseExec(command, ['--login', '-i', '-c', shellCmd], cwd, env);
    fixOutput(result);
    return result;
  } catch (e) {
    fixOutput(e.result);
    throw e;
  }
};

export let exec: Exec = (args: CmdArgs, cwd?: FilePath, env?: NodeJS.ProcessEnv): Promise<ProcessResult> => {
  let internal: Exec = process.platform === 'win32' ? mozillaBuildExec : spawnExec;
  return internal(args, cwd, env);
};
