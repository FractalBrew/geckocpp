/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, SpawnOptions, ChildProcess } from 'child_process';

import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';

import { log } from './logging';
import * as shared from './shared';
import { config } from './config';

function fsStat(path: string): Promise<fs.Stats> {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        resolve(stats);
      }
    });
  });
}

function fsReadFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, { encoding: 'utf8' }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function traverse(obj: any, ...path: string[]): any|undefined {
  if (path.length === 0) {
    return obj;
  }

  if (path[0] in obj) {
    return traverse(obj[path[0]], ...path.slice(1));
  }

  return undefined;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

class ProcessError extends Error {
  result: ProcessResult|undefined;

  constructor(command: string, result: ProcessResult|undefined) {
    if (result) {
      super(`Executing '${command}' failed with exit code ${result.code}`);
    } else {
      super(`Failed to execute process '${command}'`);
    }

    this.result = result;
  }
}

function exec(command: string, args: string[], options?: SpawnOptions): Promise<ProcessResult> {
  log.debug(`Executing '${command} ${args.join(' ')}'`);
  return new Promise((resolve, reject) => {
    let output: ProcessResult = {
      code: 0,
      stdout: '',
      stderr: '',
    };

    let process: ChildProcess = spawn(command, args, options);

    process.stdout.on('data', (data) => {
      output.stdout += data;
    });

    process.stderr.on('data', (data) => {
      output.stderr += data;
    });

    let seenError: boolean = false;
    process.on('error', () => {
      seenError = true;
      output.code = -1;
      reject(new ProcessError(`${command} ${args.join(' ')}`, output));
    });

    process.on('close', (code) => {
      if (seenError) {
        return;
      }

      if (code === 0) {
        resolve(output);
      } else {
        log.warn(`Executing '${command} ${args.join(' ')}' failed with code ${code}`);
        log.debug('Command output', output);
        output.code = code;
        reject(new ProcessError(`${command} ${args.join(' ')}`, output));
      }
    });
  });
}

function mach(uri: vscode.Uri, machPath: string, args: string[]): Promise<ProcessResult> {
  let cwd: string = path.dirname(machPath);
  let command: string = config.getMach(uri) || machPath;

  return exec(command, args, {
    cwd,
    env: config.getMachEnvironment(uri),
    shell: false,
    windowsHide: true,
  });
}

interface EnvironmentInfo {
  compilers: shared.CompilerInfo[];
  topobjdir: string;
  mach: string;
  config: Map<string, string>;
  macSDK?: string;
}

export class SourceFolder implements shared.StateProvider, shared.Disposable {
  public readonly folder: vscode.WorkspaceFolder;
  private environmentInfo: EnvironmentInfo|undefined;

  public get root(): vscode.Uri {
    return this.folder.uri;
  }

  private static async fetchEnvironmentInfo(uri: vscode.Uri): Promise<EnvironmentInfo|undefined> {
    let environment: EnvironmentInfo = {
      compilers: [],
      topobjdir: '',
      mach: '',
      config: new Map(),
    };

    // Are we even a mozilla source tree?
    if (uri.scheme === 'file') {
      let check: string = path.join(uri.fsPath, 'mach');
      try {
        let stats: fs.Stats = await fsStat(check);
        if (stats.isFile()) {
          environment.mach = check;
        } else {
          return undefined;
        }
      } catch (e) {
        // Missing mach.
        return undefined;
      }
    }

    // Find some basic configuration information.
    try {
      let env: any = JSON.parse((await mach(uri, environment.mach, ['environment', '--format', 'json'])).stdout);
      environment.topobjdir = env.topobjdir;

      let configureArgs: string[]|null|undefined = traverse(env, 'mozconfig', 'configure_args');
      if (Array.isArray(configureArgs)) {
        for (let arg of env.mozconfig.configure_args) {
          if (arg.startsWith('--with-macos-sdk=')) {
            environment.macSDK = arg.substring('--with-macos-sdk='.length);
          }
        }
      }

      let autoconf: string = path.join(environment.topobjdir, 'config', 'autoconf.mk');
      let lines: string[] = (await fsReadFile(autoconf)).split('\n');
      for (let line of lines) {
        let pos: number = line.indexOf(' = ');
        if (pos > 0) {
          environment.config.set(line.substring(0, pos).trim(), line.substring(pos + 3).trim());
        }
      }
    } catch (e) {
      log.error(`Error getting ${uri.fsPath} environment.`, e);
      return undefined;
    }

    // Figure out the compilers to use.
    for (let extension of ['c', 'cpp']) {
      let compiler: string|undefined = config.getCompiler(uri, extension);
      let hasCCache: boolean = false;
      if (!compiler) {
        let cmdLine: string|undefined = environment.config.get(extension === 'c' ? 'CC' : 'CXX');

        if (!cmdLine) {
          log.error(`Unable to find a compiler for ${extension} in ${uri.fsPath}.`);
          continue;
        }

        let cmdParts: string[] = cmdLine.split(' ');
        compiler = cmdParts.shift();

        if (cmdParts.length > 0 && environment.config.get('CCACHE') === compiler) {
          compiler = cmdParts.shift();
          hasCCache = true;
        }

        if (!compiler) {
          log.error(`Unable to find a compiler for ${extension} in ${uri.fsPath}.`);
          continue;
        }
      }
      log.debug(`Using '${compiler}' for ${extension} defaults.`);

      // Find the compiler's default preprocessor directives.
      let args: string[] = [];
      let standard: shared.VERSIONS|undefined;
      switch (extension) {
        case 'c':
          args.push(`-std=${shared.C_VERSION}`, '-xc');
          standard = shared.C_STANDARD;
          break;
        case 'cpp':
          args.push(`-std=${shared.CPP_VERSION}`, '-xc++');
          standard = shared.CPP_STANDARD;
          break;
      }

      if (!standard) {
        log.error(`Attempting to find compiler for unexpected extension ${extension}`);
        continue;
      }

      let info: shared.CompilerInfo = {
        compiler,
        extension,
        hasCCache,
        standard,
        frameworkIncludes: new Set(),
        includes: new Set(),
        defines: new Map(),
      };

      if (environment.macSDK) {
        args.push('-isysroot');
        args.push(environment.macSDK);
      }

      args.push('-Wp,-v', '-E', '-dD', '/dev/null');
      try {
        let result: ProcessResult = await exec(compiler, args, {
          shell: false,
          windowsHide: true,
        });

        shared.parseCompilerDefaults(info, result.stdout);
        shared.parseCompilerDefaults(info, result.stderr);

        if (info.defines.size === 0 || info.includes.size === 0) {
          log.error(`Failed to discover any default includes or defines from ${compiler}`);
          log.debug('stdout:', result.stdout);
          log.debug('stderr:', result.stderr);
          return undefined;
        }

        log.debug(`Discovered ${info.includes.size} includes and ${info.defines.size} defines.`);
      } catch (e) {
        log.error(`Failed to discover the compiler defaults for ${extension} files.`, e);
        return undefined;
      }

      environment.compilers.push(info);
    }

    return environment;
  }

  public static async create(folder: vscode.WorkspaceFolder): Promise<SourceFolder> {
    return new SourceFolder(folder, await SourceFolder.fetchEnvironmentInfo(folder.uri));
  }

  private constructor(folder: vscode.WorkspaceFolder, environmentInfo: EnvironmentInfo|undefined) {
    this.folder = folder;
    this.environmentInfo = environmentInfo;
  }

  public async toState(): Promise<any> {
    let compilerState: (i: shared.CompilerInfo) => Promise<any> = async (info: shared.CompilerInfo): Promise<any> => {
      return {
        compiler: info.compiler,
        extension: info.extension,
        standard: info.standard,
        includes: info.includes.size,
        defines: info.defines.size,
      };
    };

    let environmentState: () => Promise<any> = async(): Promise<any> => {
      if (!this.environmentInfo) {
        return undefined;
      }

      return {
        compilers: await Promise.all(this.environmentInfo.compilers.map(compilerState)),
        topobjdir: this.environmentInfo.topobjdir,
        mach: this.environmentInfo.mach,
        macSDK: this.environmentInfo.macSDK,
      };
    };

    return {
      root: this.folder.uri.toString(),
      environment: await environmentState(),
    };
  }

  public dispose(): void {
  }

  public async mach(args: string[]): Promise<ProcessResult> {
    if (!this.environmentInfo) {
      throw new Error(`Mach does not exist for the folder ${this.folder.uri}`);
    }

    return mach(this.root, this.environmentInfo.mach, args);
  }

  public hasMach(): boolean {
    return this.environmentInfo !== undefined;
  }

  public getTopSrcDir(): string {
    return this.folder.uri.fsPath;
  }

  public getTopObjDir(): string {
    return this.environmentInfo ? this.environmentInfo.topobjdir : this.folder.uri.fsPath;
  }

  public getIncludePaths(): Set<string> {
    let paths: Set<string> = new Set();
    if (!this.environmentInfo) {
      return paths;
    }

    for (let compiler of this.environmentInfo.compilers) {
      for (let path of compiler.includes) {
        paths.add(path);
      }
      for (let path of compiler.frameworkIncludes) {
        paths.add(path);
      }
    }

    return paths;
  }

  public async canProvideConfig(): Promise<boolean> {
    return this.hasMach();
  }

  public getCachedConfiguration(uri: vscode.Uri, getConfig: (folder: SourceFolder, compilerInfo: shared.CompilerInfo, path: string) => Promise<cpptools.SourceFileConfiguration|undefined>): Promise<cpptools.SourceFileConfiguration|undefined> {
    if (!this.environmentInfo) {
      return Promise.resolve(undefined);
    }

    let file: string = uri.fsPath;
    let extension: string = path.extname(file);
    if (extension.length > 0) {
      extension = extension.substring(1);
      if (extension === 'h') {
        extension = 'cpp';
      }

      for (let info of this.environmentInfo.compilers) {
        if (info.extension === extension) {
          return getConfig(this, info, uri.fsPath);
        }
      }
    }

    log.warn(`Asked for configuration for an unknown file type: ${file}`);
    return Promise.resolve(undefined);
  }
}
