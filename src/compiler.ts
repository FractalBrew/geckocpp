/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

import { Options } from 'split-string';
let split: (str: string, options: Options) => string[] = require('split-string');

import { ProcessResult, exec, CmdArgs } from './exec';
import { log } from './logging';
import { Disposable, StateProvider } from './shared';

type VERSIONS = 'c89' | 'c99' | 'c11' | 'c++98' | 'c++03' | 'c++11' | 'c++14' | 'c++17';
type INTELLISENSE_MODES = 'msvc-x64' | 'gcc-x64' | 'clang-x64';

const FRAMEWORK_MARKER: string = ' (framework directory)';

const CPP_STANDARD: VERSIONS = 'c++14';
const CPP_VERSION: string = CPP_STANDARD;
const C_STANDARD: VERSIONS = 'c99';
const C_VERSION: string = 'gnu99';

function splitCmdLine(cmdline: string): string[] {
  return split(cmdline.trim(), {
    quotes: true,
    separator: ' ',
  }).map((s: string): string => {
    if (s.length < 2) {
      return s;
    }

    if ((s.startsWith('\'') && s.endsWith('\'')) ||
        (s.startsWith('"') && s.endsWith('"'))) {
      return s.substring(1, s.length - 1);
    }

    return s;
  });
}

export enum FileType {
  C = 'c',
  CPP = 'cpp',
}

export interface Define {
  key: string;
  value: string;
}

function buildDefine(text: string, splitter: string): Define {
  let pos: number = text.indexOf(splitter);
  if (pos >= 0) {
    return {
      key: text.substring(0, pos),
      value: text.substring(pos + 1),
    };
  }

  return {
    key: text,
    value: '1',
  };
}

export interface CompileConfig {
  includes: Set<string>;
  defines: Map<string, Define>;
  forcedIncludes: Set<string>;
  intelliSenseMode: INTELLISENSE_MODES;
  standard: VERSIONS;
}

function cloneConfig(config: CompileConfig): CompileConfig {
  return {
    includes: new Set(config.includes),
    defines: new Map(config.defines),
    forcedIncludes: new Set(config.forcedIncludes),
    intelliSenseMode: config.intelliSenseMode,
    standard: config.standard,
  };
}

function addCompilerArgumentsToConfig(cmdLine: string|undefined, forceIncludeArg: string, config: CompileConfig): void {
  if (!cmdLine) {
    return;
  }

  let args: string[] = splitCmdLine(cmdLine);
  let arg: string|undefined;
  while (arg = args.shift()) {
    if (arg.length < 2 || (arg.charAt(0) !== '-' && arg.charAt(0) !== '/')) {
      continue;
    }

    switch (arg.charAt(1)) {
      case 'D':
        let define: Define = buildDefine(arg.substring(2), '=');
        config.defines.set(define.key, define);
        continue;
      case 'I':
        config.includes.add(arg.substring(2));
        continue;
    }

    if (arg === forceIncludeArg) {
      let include: string|undefined = args.shift();
      if (include) {
        config.forcedIncludes.add(include);
      }
      continue;
    }
  }
}

export abstract class Compiler implements Disposable, StateProvider {
  protected path: vscode.Uri;
  protected type: FileType;
  protected defaults: CompileConfig;

  protected constructor(path: vscode.Uri, type: FileType, defaults: CompileConfig) {
    this.path = path;
    this.type = type;
    this.defaults = defaults;
  }

  public dispose(): void {
  }

  public async toState(): Promise<any> {
    return {
      includes: this.defaults.includes.size,
      defines: this.defaults.defines.size,
    };
  }

  public static async create(path: vscode.Uri, type: FileType, config: Map<string, string>): Promise<Compiler> {
    let compilerType: string|undefined = config.get('CC_TYPE');
    if (!compilerType) {
      throw new Error('Unable to determine compiler types.');
    }

    switch (compilerType) {
      case 'clang':
        return ClangCompiler.fetch(path, type, config);
      case 'clang-cl':
      case 'msvc':
        return MsvcCompiler.fetch(path, type, compilerType);
      default:
        throw new Error(`Unknown compiler type ${compilerType}.`);
    }
  }

  public getDefaultConfiguration(): CompileConfig {
    return cloneConfig(this.defaults);
  }

  public getIncludePaths(): Set<vscode.Uri> {
    return new Set(Array.from(this.defaults.includes).map((f) => vscode.Uri.file(f)));
  }

  public abstract addCompilerArgumentsToConfig(cmdLine: string|undefined, config: CompileConfig): void;
}

class ClangCompiler extends Compiler {
  private sdk: string|undefined;

  private constructor(path: vscode.Uri, type: FileType, defaults: CompileConfig, sdk: string|undefined) {
    super(path, type, defaults);
    this.sdk = sdk;
  }

  public dispose(): void {
    super.dispose();
  }

  public async toState(): Promise<any> {
    let state: any = await super.toState();
    state.type = 'clang';
    return state;
  }

  private static parseCompilerDefaults(output: string, defaults: CompileConfig): void {
    let lines: string[] = output.trim().split('\n');

    let inIncludes: boolean = false;
    for (let line of lines) {
      if (inIncludes) {
        if (line.charAt(0) === ' ') {
          let include: string = line.trim();
          if (include.endsWith(FRAMEWORK_MARKER)) {
            defaults.includes.add(include.substring(0, include.length - FRAMEWORK_MARKER.length));
          } else {
            defaults.includes.add(include);
          }
          continue;
        } else {
          inIncludes = false;
        }
      }

      if (line.startsWith('#include ')) {
        inIncludes = true;
      } else if (line.startsWith('#define ')) {
        let define: Define = buildDefine(line.substring(8).trim(), ' ');
        defaults.defines.set(define.key, define);
      }
    }
  }

  public static async fetch(path: vscode.Uri, type: FileType, config: Map<string, string>): Promise<Compiler> {
    let sdk: string|undefined = undefined;
    if (process.platform === 'darwin') {
      sdk = config.get('MACOS_SDK_DIR');
    }

    let command: CmdArgs = [path];

    switch (type) {
      case FileType.CPP:
        command.push(`-std=${CPP_VERSION}`, '-xc++');
        break;
      case FileType.C:
        command.push(`-std=${C_VERSION}`, '-xc');
        break;
    }

    if (sdk) {
      if (process.platform === 'darwin') {
        command.push('-isysroot', sdk);
      }
    }

    command.push('-Wp,-v', '-E', '-dD', '/dev/null');

    try {
      let result: ProcessResult = await exec(command);

      let defaults: CompileConfig = {
        includes: new Set(),
        defines: new Map(),
        forcedIncludes: new Set(),
        intelliSenseMode: 'clang-x64' as INTELLISENSE_MODES,
        standard: type === FileType.C ? C_STANDARD : CPP_STANDARD,
      };

      ClangCompiler.parseCompilerDefaults(result.stdout, defaults);
      ClangCompiler.parseCompilerDefaults(result.stderr, defaults);

      if (defaults.includes.size === 0 || defaults.defines.size === 0) {
        throw new Error('Compiler returned empty includes or defined.');
      }

      return new ClangCompiler(path, type, defaults, sdk);
    } catch (e) {
      log.error('Failed to get compiler defaults', e);
      throw e;
    }
  }

  public addCompilerArgumentsToConfig(cmdLine: string|undefined, config: CompileConfig): void {
    addCompilerArgumentsToConfig(cmdLine, '-include', config);
  }
}

class MsvcCompiler extends Compiler {
  public dispose(): void {
    super.dispose();
  }

  public async toState(): Promise<any> {
    let state: any = await super.toState();
    state.type = 'clang';
    return state;
  }

  public static async fetch(path: vscode.Uri, type: FileType, compilerType: string): Promise<Compiler> {
    let defaults: CompileConfig = {
      includes: new Set(),
      defines: new Map(),
      forcedIncludes: new Set(),
      intelliSenseMode: compilerType === 'msvc' ? 'msvc-x64' : 'clang-x64' as INTELLISENSE_MODES,
      standard: type === FileType.C ? C_STANDARD : CPP_STANDARD,
    };

    if (defaults.includes.size === 0 || defaults.defines.size === 0) {
      throw new Error('Compiler returned empty includes or defined.');
    }

    return new MsvcCompiler(path, type, defaults);
  }

  public addCompilerArgumentsToConfig(cmdLine: string|undefined, config: CompileConfig): void {
    addCompilerArgumentsToConfig(cmdLine, '-FI', config);
  }
}
