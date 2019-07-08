/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ProcessResult, exec, CmdArgs, ProcessError } from './exec';
import { log } from './logging';
import { FilePath, Disposable, StateProvider, FilePathSet } from './shared';
import { config } from './config';
import { bashShellParse } from './shell';

type VERSIONS = 'c89' | 'c99' | 'c11' | 'c++98' | 'c++03' | 'c++11' | 'c++14' | 'c++17';
type INTELLISENSE_MODES = 'msvc-x64' | 'gcc-x64' | 'clang-x64';

const FRAMEWORK_MARKER: string = ' (framework directory)';

const CPP_STANDARD: VERSIONS = 'c++14';
const CPP_VERSION: string = CPP_STANDARD;
const C_STANDARD: VERSIONS = 'c99';
const C_VERSION: string = 'gnu99';

export enum FileType {
  C = 'c',
  CPP = 'cpp',
}

export class Define {
  private defineKey: string;
  private defineValue: string|undefined;

  private constructor(key: string, value?: string) {
    this.defineKey = key;
    this.defineValue = value;
  }

  public static fromCode(code: string): Define {
    let pos: number = code.indexOf(' ');
    if (pos >= 0) {
      return new Define(code.substring(0, pos), code.substring(pos + 1));
    }
    return new Define(code);
  }

  public static fromArgument(argument: string): Define {
    let pos: number = argument.indexOf('=');
    if (pos >= 0) {
      return new Define(argument.substring(0, pos), argument.substring(pos + 1));
    }
    return new Define(argument);
  }

  public get key(): string {
    return this.defineKey;
  }

  public get value(): string|undefined {
    return this.defineValue;
  }

  public toString(): string {
    if (this.value) {
      return `${this.key}=${this.value}`;
    }
    return this.key;
  }
}

export interface CompileConfig {
  includes: FilePathSet;
  defaultIncludes: FilePathSet;
  defaultSysIncludes: FilePathSet;
  osxFrameworkIncludes: FilePathSet;
  defines: Map<string, Define>;
  defaultDefines: Map<string, Define>;
  forcedIncludes: FilePathSet;
  intelliSenseMode: INTELLISENSE_MODES;
  standard: VERSIONS;
  compilerPath?: string;
  windowsSdkVersion?: string;
  osxSdk?: FilePath;
}

function cloneConfig(config: CompileConfig): CompileConfig {
  return {
    includes: new FilePathSet(config.includes),
    defaultIncludes: new FilePathSet(config.defaultIncludes),
    defaultSysIncludes: new FilePathSet(config.defaultSysIncludes),
    osxFrameworkIncludes: new FilePathSet(config.osxFrameworkIncludes),
    defines: new Map(config.defines),
    defaultDefines: new Map(config.defaultDefines),
    forcedIncludes: new FilePathSet(config.forcedIncludes),
    intelliSenseMode: config.intelliSenseMode,
    standard: config.standard,
    compilerPath: config.compilerPath,
    windowsSdkVersion: config.windowsSdkVersion,
    osxSdk: config.osxSdk,
  };
}

function addCompilerArgumentsToConfig(cmdLine: string|undefined, forceIncludeArg: string, config: CompileConfig): void {
  if (!cmdLine) {
    return;
  }

  let args: string[] = bashShellParse(cmdLine);
  let arg: string|undefined;
  while (arg = args.shift()) {
    if (arg.length < 2 || (arg.charAt(0) !== '-' && arg.charAt(0) !== '/')) {
      continue;
    }

    switch (arg.charAt(1)) {
      case 'D':
        let define: Define = Define.fromArgument(arg.substring(2));
        config.defines.set(define.key, define);
        continue;
      case 'I':
        config.includes.add(FilePath.fromUnixy(arg.substring(2)));
        continue;
    }

    if (arg === forceIncludeArg) {
      let include: FilePath|string|undefined = args.shift();
      if (typeof include === 'string') {
        config.forcedIncludes.add(FilePath.fromUnixy(include));
      }
      continue;
    }
  }
}

export abstract class Compiler implements Disposable, StateProvider {
  protected srcdir: FilePath;
  protected command: CmdArgs;
  protected type: FileType;
  protected defaults: CompileConfig;

  protected constructor(srcdir: FilePath, command: CmdArgs, type: FileType, defaults: CompileConfig) {
    this.srcdir = srcdir;
    this.command = command;
    this.type = type;
    this.defaults = defaults;
  }

  public dispose(): void {
  }

  public async toState(): Promise<any> {
    return {
      type: this.type,
      command: this.command,
      override: await config.getCompiler(this.srcdir.toUri(), this.type),
      includes: Array.from(this.defaults.includes),
      defaultIncludes: Array.from(this.defaults.defaultIncludes),
      defaultSysIncludes: Array.from(this.defaults.defaultSysIncludes),
      osxFrameworkIncludes: Array.from(this.defaults.osxFrameworkIncludes),
      defaultDefines: this.defaults.defaultDefines.size,
      defines: Array.from(this.defaults.defines.values()).map((d) => d.toString()),
    };
  }

  public static async create(srcdir: FilePath, command: CmdArgs, type: FileType, config: Map<string, string>): Promise<Compiler> {
    let compilerType: string|undefined = config.get('CC_TYPE');
    if (!compilerType) {
      throw new Error('Unable to determine compiler types.');
    }

    switch (compilerType) {
      case 'clang':
        return ClangCompiler.fetch(srcdir, command, type, config);
      case 'clang-cl':
      case 'msvc':
        return MsvcCompiler.fetch(srcdir, command, type, compilerType);
      default:
        throw new Error(`Unknown compiler type ${compilerType}.`);
    }
  }

  protected async getCommand(): Promise<CmdArgs> {
    return (await config.getCompiler(this.srcdir.toUri(), this.type)) || this.command.slice(0);
  }

  public getIncludePaths(): FilePathSet {
    let includes: FilePathSet = new FilePathSet();
    function addIncludes(set: FilePathSet): void {
      for (let include of set) {
        includes.add(include);
      }
    }

    addIncludes(this.defaults.defaultSysIncludes);
    addIncludes(this.defaults.defaultIncludes);
    addIncludes(this.defaults.osxFrameworkIncludes);
    addIncludes(this.defaults.includes);

    return new FilePathSet(includes);
  }

  public abstract getConfigForArguments(cmdLine: string|undefined): CompileConfig;

  public abstract compile(cmdLine: string|undefined, source: FilePath): Promise<ProcessResult>;
}

class ClangCompiler extends Compiler {
  public dispose(): void {
    super.dispose();
  }

  public async toState(): Promise<any> {
    let state: any = await super.toState();
    state.type = 'clang';
    return state;
  }

  public static parseCompilerDefaults(output: string[], defaults: CompileConfig): void {
    let inIncludes: boolean = false;
    let inSysIncludes: boolean = false;

    for (let line of output) {
      if (inIncludes) {
        if (line.charAt(0) === ' ') {
          let include: string = line.trim();
          if (include.endsWith(FRAMEWORK_MARKER)) {
            defaults.osxFrameworkIncludes.add(FilePath.fromPath(include.substring(0, include.length - FRAMEWORK_MARKER.length)));
          } else if (inSysIncludes) {
            defaults.defaultSysIncludes.add(FilePath.fromPath(include));
          } else {
            defaults.defaultIncludes.add(FilePath.fromPath(include));
          }
          continue;
        } else {
          inIncludes = false;
        }
      }

      if (line.startsWith('#include ')) {
        inIncludes = true;
        inSysIncludes = line.charAt(9) === '<';
      } else if (line.startsWith('#define ')) {
        let define: Define = Define.fromCode(line.substring(8).trim());
        defaults.defaultDefines.set(define.key, define);
      }
    }
  }

  public static async fetch(srcdir: FilePath, command: CmdArgs, type: FileType, buildConfig: Map<string, string>): Promise<Compiler> {
    let sdk: string|undefined = undefined;
    if (process.platform === 'darwin') {
      sdk = buildConfig.get('MACOS_SDK_DIR');
    }

    let defaultCmd: CmdArgs = (await config.getCompiler(srcdir.toUri(), type)) || command.slice(0);

    switch (type) {
      case FileType.CPP:
        defaultCmd.push(`-std=${CPP_VERSION}`, '-xc++');
        break;
      case FileType.C:
        defaultCmd.push(`-std=${C_VERSION}`, '-xc');
        break;
    }

    if (sdk) {
      if (process.platform === 'darwin') {
        defaultCmd.push('-isysroot', sdk);
      }
    }

    defaultCmd.push('-Wp,-v', '-E', '-dD', '/dev/null');

    try {
      let result: ProcessResult = await exec(defaultCmd);

      let defaults: CompileConfig = {
        includes: new FilePathSet(),
        defaultIncludes: new FilePathSet(),
        defaultSysIncludes: new FilePathSet(),
        osxFrameworkIncludes: new FilePathSet(),
        defines: new Map(),
        defaultDefines: new Map(),
        forcedIncludes: new FilePathSet(),
        intelliSenseMode: 'msvc-x64' as INTELLISENSE_MODES,
        standard: type === FileType.C ? C_STANDARD : CPP_STANDARD,
      };

      ClangCompiler.parseCompilerDefaults(result.output, defaults);

      if (defaults.defaultDefines.size === 0 && !defaults.compilerPath) {
        throw new Error('Failed to discover compiler defaults.');
      }
  
      return new ClangCompiler(srcdir, command, type, defaults);
    } catch (e) {
      log.error('Failed to get compiler defaults', e);
      throw e;
    }
  }

  public getConfigForArguments(cmdLine: string|undefined): CompileConfig {
    let config: CompileConfig = cloneConfig(this.defaults);
    addCompilerArgumentsToConfig(cmdLine, '-include', config);
    return config;
  }

  public async compile(cmdLine: string|undefined, source: FilePath): Promise<ProcessResult> {
    let compileConfig: CompileConfig = this.getConfigForArguments(cmdLine);

    let command: CmdArgs = (await config.getCompiler(source.toUri(), this.type)) || this.command.slice(0);
    if (this.defaults.osxSdk) {
      command.push('-isysroot', this.defaults.osxSdk.toPath());
    }

    switch (this.type) {
      case FileType.CPP:
        command.push(`-std=${CPP_VERSION}`, '-xc++');
        break;
      case FileType.C:
        command.push(`-std=${C_VERSION}`, '-xc');
        break;
    }

    command.push('-c', '-Wno-everything');

    for (let define of compileConfig.defines.values()) {
      command.push(`-D${define}`);
    }

    for (let include of compileConfig.includes) {
      command.push(`-I${include.toPath()}`);
    }

    for (let include of compileConfig.forcedIncludes) {
      command.push('-include', include.toPath());
    }

    command.push(source.toPath());

    try {
      return await exec(command, source.parent());
    } catch (e) {
      if (e instanceof ProcessError) {
        return e.result;
      }
      throw e;
    }
  }
}

class MsvcCompiler extends Compiler {
  public dispose(): void {
    super.dispose();
  }

  public async toState(): Promise<any> {
    let state: any = await super.toState();
    state.type = 'clang-cl';
    return state;
  }

  public static async fetch(srcdir: FilePath, command: CmdArgs, type: FileType, compilerType: string): Promise<Compiler> {
    if (compilerType === 'msvc') {
      throw new Error('The msvc compiler is currently not supported.');
    }

    let defaultCmd: CmdArgs = (await config.getCompiler(srcdir.toUri(), type)) || command.slice(0);

    switch (type) {
      case FileType.CPP:
        defaultCmd.push(`-std:${CPP_VERSION}`, '-TP');
        break;
      case FileType.C:
        defaultCmd.push(`-std:${C_VERSION}`, '-TC');
        break;
    }

    defaultCmd.push('-v', '-E', '-Xclang', '-dM', '/dev/null');

    try {
      let result: ProcessResult = await exec(defaultCmd);

      let defaults: CompileConfig = {
        includes: new FilePathSet(),
        defaultIncludes: new FilePathSet(),
        defaultSysIncludes: new FilePathSet(),
        osxFrameworkIncludes: new FilePathSet(),
        defines: new Map(),
        defaultDefines: new Map(),
        forcedIncludes: new FilePathSet(),
        intelliSenseMode: compilerType === 'msvc' ? 'msvc-x64' : 'clang-x64' as INTELLISENSE_MODES,
        standard: type === FileType.C ? C_STANDARD : CPP_STANDARD,
      };

      ClangCompiler.parseCompilerDefaults(result.output, defaults);

      if (defaults.defaultDefines.size === 0 && !defaults.compilerPath) {
        throw new Error('Failed to discover compiler defaults.');
      }

      return new MsvcCompiler(srcdir, command, type, defaults);
    } catch (e) {
      log.error('Failed to get compiler defaults', e);
      throw e;
    }
  }

  public getConfigForArguments(cmdLine: string|undefined): CompileConfig {
    let config: CompileConfig = cloneConfig(this.defaults);
    addCompilerArgumentsToConfig(cmdLine, '-FI', config);
    return config;
  }

  public async compile(cmdLine: string|undefined, source: FilePath): Promise<ProcessResult> {
    let compileConfig: CompileConfig = this.getConfigForArguments(cmdLine);
    let command: CmdArgs = (await config.getCompiler(source.toUri(), this.type)) || this.command.slice(0);

    switch (this.type) {
      case FileType.CPP:
        command.push(`-std=${CPP_VERSION}`, '-TP');
        break;
      case FileType.C:
        command.push(`-std=${C_VERSION}`, '-TC');
        break;
    }

    command.push('-c', '-W0');

    for (let define of compileConfig.defines.values()) {
      command.push(`-D${define}`);
    }

    for (let include of compileConfig.includes) {
      command.push(`-I${include.toPath()}`);
    }

    for (let include of compileConfig.forcedIncludes) {
      command.push('-FI', include.toPath());
    }

    command.push(source.toPath());

    try {
      return await exec(command, source.parent());
    } catch (e) {
      if (e instanceof ProcessError) {
        return e.result;
      }
      throw e;
    }
  }
}
