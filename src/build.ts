/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as path from 'path';
import { Stats, promises as fs } from 'fs';

import * as vscode from 'vscode';
import { SourceFileConfiguration } from 'vscode-cpptools';

import { log } from './logging';
import { config } from './config';
import { ProcessResult, exec, CmdArgs } from './exec';
import { into, Disposable, StateProvider, FilePath, FilePathSet } from './shared';
import { Compiler, FileType } from './compiler';
import { bashShellParse } from './shell';

interface MozConfig {
  configure_args: string[];
  make_extra: string[];
  make_flags: string[];
  path: string;
}

interface MachEnvironment {
  mozconfig: MozConfig;
  topobjdir: '';
  topsrcdir: '';
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
  private srcdir: FilePath;
  private command: CmdArgs;

  public constructor(srcdir: FilePath, command: CmdArgs) {
    this.srcdir = srcdir;
    this.command = command;
  }

  public dispose(): void {
  }

  public async toState(): Promise<any> {
    return {
      command: this.command,
      override: await config.getMach(this.srcdir.toUri()),
      environment: config.getMachEnvironment(this.srcdir.toUri()),
    };
  }

  private async getCommand(): Promise<CmdArgs> {
    return (await config.getMach(this.srcdir.toUri())) || this.command.slice(0);
  }

  private async baseExec(args: CmdArgs): Promise<ProcessResult> {
    let command: CmdArgs = await this.getCommand();
    command.push(...args);

    return exec(command, this.srcdir, config.getMachEnvironment(this.srcdir.toUri()));
  }

  public async getEnvironment(): Promise<MachEnvironment> {
    try {
      let result: ProcessResult = await this.baseExec(['environment', '--format', 'json']);
      let data: string = result.stdout.join('');
      try {
        let json: any = JSON.parse(data);
        return intoEnvironment(json);
      } catch (e) {
        log.error('Failed to parse mach environment.', data);
        throw e;
      }
    } catch (e) {
      log.error('Unable to parse mach environment.', e);
      throw new Error('Unable to parse mach environment.');
    }
  }
}

export abstract class Build implements Disposable, StateProvider {
  protected mach: Mach;
  protected srcdir: FilePath;

  protected constructor(mach: Mach, srcdir: FilePath) {
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

    let srcdir: FilePath = FilePath.fromUri(root);

    let machPath: FilePath = srcdir.join('mach');
    try {
      let stats: Stats = await machPath.stat();
      if (!stats.isFile) {
        log.debug(`No mach found in ${root}`);
        return undefined;
      }
    } catch (e) {
      log.debug(`No mach found in ${root}`);
      return undefined;
    }

    let mach: Mach = new Mach(srcdir, [machPath]);

    try {
      let environment: MachEnvironment = await mach.getEnvironment();
      if (!FilePath.fromUnixy(environment.topsrcdir).equals(srcdir)) {
        log.error('Mach environment contained unexpected topsrcdir.');
        return undefined;
      }
      return RecursiveMakeBuild.build(mach, srcdir, environment);
    } catch (e) {
      return undefined;
    }
  }

  public abstract getObjDir(): FilePath;

  public abstract getIncludePaths(): FilePathSet;

  public abstract getSourceConfiguration(path: FilePath): Promise<SourceFileConfiguration|undefined>;

  public abstract testCompile(path: FilePath): Promise<void>;
}

async function parseConfig(path: FilePath, config: Map<string, string>): Promise<void> {
  log.debug(`Parsing config from ${path}`);
  let lines: string[] = (await fs.readFile(path.toPath(), { encoding: 'utf8' })).trim().split('\n');
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

  private constructor(mach: Mach, srcdir: FilePath, environment: MachEnvironment, cCompiler: Compiler, cppCompiler: Compiler) {
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

  public static async build(mach: Mach, srcdir: FilePath, environment: MachEnvironment): Promise<Build|undefined> {
    let config: Map<string, string> = new Map();

    let baseConfig: FilePath = FilePath.fromPath(path.join(environment.topobjdir, 'config', 'autoconf.mk'));
    await parseConfig(baseConfig, config);

    let cPath: string|undefined = config.get('_CC');
    if (!cPath) {
      log.error('No C compiler found.');
      return undefined;
    }

    let cppPath: string|undefined = config.get('_CXX');
    if (!cppPath) {
      log.error('No C++ compiler found.');
      return undefined;
    }

    try {
      return new RecursiveMakeBuild(mach, srcdir, environment,
        await Compiler.create(srcdir, [FilePath.fromUnixy(cPath)], FileType.C, config),
        await Compiler.create(srcdir, [FilePath.fromUnixy(cppPath)], FileType.CPP, config),
      );
    } catch (e) {
      log.error('Failed to find compilers.', e);
      return undefined;
    }
  }

  public getObjDir(): FilePath {
    return FilePath.fromUnixy(this.environment.topobjdir);
  }

  public getIncludePaths(): FilePathSet {
    let result: FilePathSet = new FilePathSet();

    result.add(this.srcdir);

    let objdir: FilePath = this.getObjDir();
    result.add(objdir.join("dist", "include"));
    result.add(objdir.join("dist", "include", "nss"));
    result.add(objdir.join("dist", "include", "nspr"));
    result.add(objdir.join("ipc", "ipdl", "_ipdlheaders"));

    for (let path of this.cCompiler.getIncludePaths()) {
      result.add(path);
    }

    for (let path of this.cppCompiler.getIncludePaths()) {
      result.add(path);
    }

    return result;
  }

  public async getSourceConfiguration(source: FilePath): Promise<SourceFileConfiguration|undefined> {
    let type: string = source.extname();
    let backend: FilePath = source.parent().rebase(this.srcdir, this.getObjDir()).join('backend.mk');
    let dirConfig: Map<string, string> = new Map();
    await parseConfig(backend, dirConfig);

    if (type === '.h' && source.changeType('c').isFile()) {
      type = '.c';
    }

    let args: string|undefined = type === '.c' ? dirConfig.get('COMPUTED_CFLAGS') : dirConfig.get('COMPUTED_CXXFLAGS');
    if (!args) {
      return undefined;
    }

    let compiler: Compiler = type === '.c' ? this.cCompiler : this.cppCompiler;
    return compiler.getSourceConfigForArguments(bashShellParse(args));
  }

  public async testCompile(source: FilePath): Promise<void> {
    let type: string = source.extname();
    let backend: FilePath = source.parent().rebase(this.srcdir, this.getObjDir()).join('backend.mk');
    let dirConfig: Map<string, string> = new Map();
    await parseConfig(backend, dirConfig);

    let compiler: Compiler = type === '.c' ? this.cCompiler : this.cppCompiler;
    let args: string|undefined = dirConfig.get(type === '.c' ? 'COMPUTED_CFLAGS' : 'COMPUTED_CXXFLAGS');
    if (!args) {
      return;
    }

    try {
      let result: ProcessResult = await compiler.compile(source, bashShellParse(args));
      let output: string = result.exitCode === 0 ?
          `Compiling ${source.toPath()} succeeded:` :
          `Compiling ${source.toPath()} failed with exit code ${result.exitCode}:`;
      output += `\n${result.output.join('')}`;
      log.writeOutput(true, output);
      console.log(result.getForConsole());
    } catch (e) {
      log.error(e);
    }
  }
}
