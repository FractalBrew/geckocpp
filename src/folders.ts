/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, SpawnOptions, ChildProcess } from 'child_process';

import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';

import { Workspace } from './workspace';
import { log } from './logging';
import { VERSIONS, splitCmdLine, parseCompilerDefaults, CPP_VERSION, CPP_STANDARD, C_VERSION, C_STANDARD, CompilerInfo } from './shared';
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
    let process: ChildProcess = spawn(command, args, options);

    let output: ProcessResult = {
      code: 0,
      stdout: '',
      stderr: '',
    };

    process.stdout.on('data', (data) => {
      output.stdout += data;
    });

    process.stderr.on('data', (data) => {
      output.stderr += data;
    });

    process.on('close', (code) => {
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
  compilers: CompilerInfo[];
  topobjdir: string;
  mach: string;
  macFramework?: string;
}

export class SourceFolder {
  private workspace: Workspace;
  private folder: vscode.WorkspaceFolder;
  private environmentInfo: EnvironmentInfo|undefined;

  public get root(): vscode.Uri {
    return this.folder.uri;
  }

  private static async fetchEnvironmentInfo(uri: vscode.Uri): Promise<EnvironmentInfo|undefined> {
    let environment: EnvironmentInfo = {
      compilers: [],
      topobjdir: '',
      mach: '',
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

      for (let arg of env.mozconfig.configure_args) {
        if (arg.startsWith('--with-macos-sdk=')) {
          environment.macFramework = arg.substring('--with-macos-sdk='.length);
        }
      }
    } catch (e) {
      log.error(`Error getting ${uri.fsPath} environment.`, e);
      return undefined;
    }

    // Figure out the compilers to use.
    for (let extension of ['c', 'cpp']) {
      let compiler: string|undefined = config.getCompiler(uri, extension);
      if (!compiler) {
        try {
          let testFile: string = path.join(uri.fsPath, `test.${extension}`);
          let output: ProcessResult = await mach(uri, environment.mach, ['compileflags', testFile]);

          let args: string[] = splitCmdLine(output.stdout);
          if (args.length > 0) {
            compiler = args[0];
          } else {
            log.error(`Running mach in ${uri.fsPath} failed to return any output.`);
            return undefined;
          }
        } catch (e) {
          log.error(`Failed searching for a compiler for ${extension} files.`, e);
          return undefined;
        }
      }
      log.debug(`Using '${compiler}' for ${extension} defaults.`);

      // Find the compiler's default preprocessor directives.
      let args: string[] = [];
      let standard: VERSIONS|undefined;
      switch (extension) {
        case 'c':
          args.push(`-std=${C_VERSION}`, '-xc');
          standard = C_STANDARD;
          break;
        case 'cpp':
          args.push(`-std=${CPP_VERSION}`, '-xc++');
          standard = CPP_STANDARD;
          break;
      }

      if (!standard) {
        log.error(`Attempting to find compiler for unexpected extension ${extension}`);
        continue;
      }

      let info: CompilerInfo = {
        compiler,
        extension,
        standard,
        frameworkIncludes: new Set(),
        includes: new Set(),
        defines: new Map(),
      };

      if (environment.macFramework) {
        args.push('-isysroot');
        args.push(environment.macFramework);
      }

      args.push('-Wp,-v', '-E', '-dD', '/dev/null');
      try {
        let result: ProcessResult = await exec(compiler, args, {
          shell: false,
          windowsHide: true,
        });

        parseCompilerDefaults(info, result.stdout);
        parseCompilerDefaults(info, result.stderr);
        log.debug(`Discovered ${info.includes.size} includes and ${info.defines.size} defines.`);
      } catch (e) {
        log.error(`Failed to discover the compiler defaults for ${extension} files.`, e);
        return undefined;
      }

      environment.compilers.push(info);
    }

    return environment;
  }

  public static async create(workspace: Workspace, folder: vscode.WorkspaceFolder): Promise<SourceFolder> {
    return new SourceFolder(workspace, folder, await SourceFolder.fetchEnvironmentInfo(folder.uri));
  }

  private constructor(workspace: Workspace, folder: vscode.WorkspaceFolder, environmentInfo: EnvironmentInfo|undefined) {
    this.workspace = workspace;
    this.folder = folder;
    this.environmentInfo = environmentInfo;
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

  public getCachedConfiguration(uri: vscode.Uri, getConfig: (folder: SourceFolder, compilerInfo: CompilerInfo, path: string) => Promise<cpptools.SourceFileConfiguration|undefined>): Promise<cpptools.SourceFileConfiguration|undefined> {
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
