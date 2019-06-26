import * as path from 'path';
import * as fs from 'fs';
import { spawn, SpawnOptions } from 'child_process';

import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';

import { Workspace } from './workspace';
import { log } from './logging';

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

interface ProcessResult {
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
    let process = spawn(command, args, options);

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

function mach(machPath: string, args: string[]): Promise<ProcessResult> {
  let config = vscode.workspace.getConfiguration('mozillacpp');

  let cwd = path.dirname(machPath);
  let command: string = config.get('mach') || machPath;

  let env = Object.assign({}, config.get('mach_env') || {}, process.env);

  return exec(command, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
  });
}

export class WorkspaceFolder {
  private workspace: Workspace;
  private folder: vscode.WorkspaceFolder;
  private machPath: string|undefined;
  private topobjdir: string|undefined;

  public static async create(workspace: Workspace, folder: vscode.WorkspaceFolder): Promise<WorkspaceFolder> {
    let machPath: string|undefined = undefined;
    let topobjdir: string|undefined = undefined;

    if (folder.uri.scheme === 'file') {
      let check = path.join(folder.uri.fsPath, 'mach');
      try {
        let stats = await fsStat(check);
        if (stats.isFile()) {
          machPath = check;
        }
      } catch (e) {
        // Missing mach.
      }
    }

    if (machPath) {
      try {
        let env = JSON.parse((await mach(machPath, ['environment', '--format', 'json'])).stdout);
        topobjdir = env.topobjdir;
      } catch (e) {
        log.error(`Error getting ${folder.uri.fsPath} objdir.`, e);
      }
    }

    return new WorkspaceFolder(workspace, folder, machPath, topobjdir);
  }

  private constructor(workspace: Workspace, folder: vscode.WorkspaceFolder, machPath: string|undefined, topobjdir: string|undefined) {
    this.workspace = workspace;
    this.folder = folder;
    this.machPath = machPath;
    this.topobjdir = topobjdir;
  }

  public async mach(args: string[]): Promise<ProcessResult> {
    if (!this.machPath) {
      throw new Error(`Mach does not exist for the folder ${this.folder.uri}`);
    }

    return mach(this.machPath, args);
  }

  public hasMach(): boolean {
    return this.machPath !== null;
  }

  public getTopSrcDir(): string {
    return this.folder.uri.fsPath;
  }

  public getTopObjDir(): string {
    return this.topobjdir ? this.topobjdir : this.folder.uri.fsPath;
  }

  public async canProvideConfig(): Promise<boolean> {
    return this.hasMach();
  }

  public getCachedConfiguration(uri: vscode.Uri, getConfig: (folder: WorkspaceFolder, path: string) => Promise<cpptools.SourceFileConfiguration|undefined>): Promise<cpptools.SourceFileConfiguration|undefined> {
    return getConfig(this, uri.fsPath);
  }
}
