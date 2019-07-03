/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as path from 'path';
import { Stats, promises as fs } from 'fs';

import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';

import { log } from './logging';
import { config } from './config';
import { ProcessResult, exec, CmdArgs } from './exec';
import { into, Disposable, StateProvider } from './shared';
import { Compiler, FileType, CompileConfig } from './compiler';

interface MozConfig {
  configure_args: string[];
  make_extra: string[];
  make_flags: string[];
  path: string;
}

interface MachEnvironment {
  mozconfig: MozConfig;
  topobjdir: string;
  topsrcdir: string;
}

function intoEnvironment(json: any): MachEnvironment {
  let template: MachEnvironment = {
    mozconfig: {
      configure_args: [''],
      make_extra: [''],
      make_flags: [''],
      path: '',
    },
    topobjdir: '',
    topsrcdir: '',
  };

  return into(json, template);
}

class Mach implements Disposable, StateProvider {
  private srcdir: vscode.Uri;
  private machPath: vscode.Uri;

  public constructor(srcdir: vscode.Uri, machPath: vscode.Uri) {
    this.srcdir = srcdir;
    this.machPath = machPath;
  }

  public dispose(): void {
  }

  public async toState(): Promise<any> {
    return this.machPath;
  }

  private baseExec(args: CmdArgs): Promise<ProcessResult> {
    let command: vscode.Uri = config.getMach(this.srcdir) || this.machPath;
    let cmdArgs: CmdArgs = args.slice(0);
    cmdArgs.unshift(command);

    return exec(cmdArgs, this.srcdir, config.getMachEnvironment(this.srcdir));
  }

  public async getEnvironment(): Promise<MachEnvironment> {
    try {
      let result: ProcessResult = await this.baseExec(['environment', '--format', 'json']);
      return intoEnvironment(JSON.parse(result.stdout));
    } catch (e) {
      log.error(e);
      throw new Error('Unable to parse mach environment.');
    }
  }
}

export abstract class Build implements Disposable, StateProvider {
  protected mach: Mach;
  protected srcdir: vscode.Uri;

  protected constructor(mach: Mach, srcdir: vscode.Uri) {
    this.mach = mach;
    this.srcdir = srcdir;
  }

  public dispose(): void {
    this.mach.dispose();
  }

  public async toState(): Promise<any> {
    return { mach: await this.mach.toState() };
  }

  public static async create(root: vscode.Uri): Promise<Build|undefined> {
    if (root.scheme !== 'file') {
      return undefined;
    }

    let machPath: string = path.join(root.fsPath, 'mach');
    try {
      let stats: Stats = await fs.stat(machPath);
      if (!stats.isFile) {
        log.debug(`No mach found in ${root}`);
        return undefined;
      }
    } catch (e) {
      log.debug(`No mach found in ${root}`);
      return undefined;
    }

    let mach: Mach = new Mach(root, vscode.Uri.file(machPath));

    try {
      let environment: MachEnvironment = await mach.getEnvironment();
      if (environment.topsrcdir !== root.fsPath) {
        log.error('Mach environment contained unexpected topsrcdir.');
        return undefined;
      }
      return RecursiveMakeBuild.build(mach, root, environment);
    } catch (e) {
      return undefined;
    }
  }

  public abstract getObjDir(): vscode.Uri;

  public abstract getIncludePaths(): Set<vscode.Uri>;

  public abstract getSourceConfiguration(uri: vscode.Uri): Promise<CompileConfig|undefined>;
}

async function parseConfig(path: string, config: Map<string, string>): Promise<void> {
  log.debug(`Parsing config from ${path}`);
  let lines: string[] = (await fs.readFile(path, { encoding: 'utf8' })).trim().split('\n');
  for (let line of lines) {
    let pos: number = line.indexOf(' = ');
    if (pos > 0) {
      let key: string = line.substring(0, pos).trim();
      let value: string = line.substring(pos + 3).trim();
      config.set(key, value);
      continue;
    }

    pos = line.indexOf(' += ');
    if (pos > 0) {
      let key: string = line.substring(0, pos).trim();
      let value: string = line.substring(pos + 4).trim();
      let previous: string|undefined = config.get(key);
      if (previous) {
        value = `${previous} ${value}`;
      }
      config.set(key, value);
    }
  }
}

class RecursiveMakeBuild extends Build {
  private environment: MachEnvironment;
  private cCompiler: Compiler;
  private cppCompiler: Compiler;

  private constructor(mach: Mach, srcdir: vscode.Uri, environment: MachEnvironment, cCompiler: Compiler, cppCompiler: Compiler) {
    super(mach, srcdir);
    this.environment = environment;
    this.cCompiler = cCompiler;
    this.cppCompiler = cppCompiler;
  }

  public dispose(): void {
    super.dispose();
    this.cCompiler.dispose();
    this.cppCompiler.dispose();
  }

  public async toState(): Promise<any> {
    let state: any = await super.toState();
    state.cCompiler = await this.cCompiler.toState();
    state.cppCompiler = await this.cppCompiler.toState();
    return state;
  }

  public static async build(mach: Mach, srcdir: vscode.Uri, environment: MachEnvironment): Promise<Build|undefined> {
    let config: Map<string, string> = new Map();

    let baseConfig: string = path.join(environment.topobjdir, 'config', 'autoconf.mk');
    await parseConfig(baseConfig, config);

    let cPath: string|undefined = config.get('_CC');
    if (!cPath) {
      log.error('No C compiler found.');
      return undefined;
    }

    let cppPath: string|undefined = config.get('_CC');
    if (!cppPath) {
      log.error('No C++ compiler found.');
      return undefined;
    }

    try {
      return new RecursiveMakeBuild(mach, srcdir, environment,
        await Compiler.create(vscode.Uri.file(cPath), FileType.C, config),
        await Compiler.create(vscode.Uri.file(cppPath), FileType.CPP, config),
      );
    } catch (e) {
      log.error('Failed to find compilers.', e);
      return undefined;
    }
  }

  public getObjDir(): vscode.Uri {
    return vscode.Uri.file(this.environment.topobjdir);
  }

  public getIncludePaths(): Set<vscode.Uri> {
    let result: Set<vscode.Uri> = new Set();

    result.add(this.srcdir);
    result.add(this.getObjDir());

    for (let path of this.cCompiler.getIncludePaths()) {
      result.add(path);
    }

    for (let path of this.cppCompiler.getIncludePaths()) {
      result.add(path);
    }

    return result;
  }

  public async getSourceConfiguration(uri: vscode.Uri): Promise<CompileConfig|undefined> {
    let type: string = path.extname(uri.fsPath);
    let relativeDir: string = path.relative(this.srcdir.fsPath, path.dirname(uri.fsPath));
    let backend: string = path.join(this.getObjDir().fsPath, relativeDir, 'backend.mk');
    let dirConfig: Map<string, string> = new Map();
    await parseConfig(backend, dirConfig);

    let config: CompileConfig|undefined = undefined;

    switch (type) {
      case '.c': {
        let args: string|undefined = dirConfig.get('COMPUTED_CFLAGS');
        config = this.cCompiler.getDefaultConfiguration();
        this.cCompiler.addCompilerArgumentsToConfig(args, config);
        break;
      }
      case '.cpp': {
        let args: string|undefined = dirConfig.get('COMPUTED_CXXFLAGS');
        config = this.cppCompiler.getDefaultConfiguration();
        this.cCompiler.addCompilerArgumentsToConfig(args, config);
        break;
      }
      default:
        log.debug(`Asked for configuration for an unknown extension: ${type}`);
    }

    return config;
  }
}
