/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { shellQuote } from "shell-args";
import { SourceFileConfiguration } from "vscode-cpptools";

import { config } from "./config";
import { ProcessResult, exec, CmdArg, ProcessError } from "./exec";
import { log } from "./logging";
import { FilePath, Disposable, StateProvider, FilePathSet } from "./shared";

type VERSIONS = "c89" | "c99" | "c11" | "c++98" | "c++03" | "c++11" | "c++14" | "c++17";
type INTELLISENSE_MODES = "msvc-x64" | "gcc-x64" | "clang-x64";

const FRAMEWORK_MARKER = " (framework directory)";

const CPP_STANDARD: VERSIONS = "c++17";
const CPP_VERSION: string = CPP_STANDARD;
const C_STANDARD: VERSIONS = "c99";
const C_VERSION = "gnu99";

export enum FileType {
  C = "c",
  CPP = "cpp",
}

export class Define {
  private defineKey: string;
  private defineValue: string | undefined;

  private constructor(key: string, value?: string) {
    this.defineKey = key;
    this.defineValue = value;
  }

  public static fromCode(code: string): Define {
    let pos: number = code.indexOf(" ");
    if (pos >= 0) {
      return new Define(code.substring(0, pos), code.substring(pos + 1));
    }
    return new Define(code);
  }

  public static fromArgument(argument: string): Define {
    let pos: number = argument.indexOf("=");
    if (pos >= 0) {
      return new Define(argument.substring(0, pos), argument.substring(pos + 1));
    }
    return new Define(argument);
  }

  public get key(): string {
    return this.defineKey;
  }

  public get value(): string | undefined {
    return this.defineValue;
  }

  public toString(): string {
    if (this.value) {
      return `${this.key}=${this.value}`;
    }
    return this.key;
  }
}

type DefineSet = Map<string, Define>;

function definesAsArray(...defineList: DefineSet[]): string[] {
  let result: string[] = [];
  for (let defines of defineList) {
    for (let define of defines.values()) {
      result.push(define.toString());
    }
  }
  return result;
}

function pathsAsArray(...pathlist: FilePathSet[]): string[] {
  let result: string[] = [];
  for (let paths of pathlist) {
    for (let path of paths) {
      result.push(path.toPath());
    }
  }
  return result;
}

interface CompilerDefaults {
  includes: FilePathSet;
  sysIncludes: FilePathSet;
  osxFrameworkIncludes: FilePathSet;
  defines: DefineSet;
}

interface CompilerSettings {
  intelliSenseMode: INTELLISENSE_MODES;
  standard: string;
  version: string;
  windowsSdkVersion?: string;
  osxSdk?: FilePath;
}

interface FileConfig {
  includes: FilePathSet;
  defines: DefineSet;
  forcedIncludes: FilePathSet;
  osxFrameworkIncludes: FilePathSet;
}

function getFileConfigForArguments(cmdLine: string[], forceIncludeArg: string): FileConfig {
  let config: FileConfig = {
    defines: new Map(),
    includes: new FilePathSet(),
    forcedIncludes: new FilePathSet(),
    osxFrameworkIncludes: new FilePathSet(),
  };

  let arg: string | undefined;
  // eslint-disable-next-line no-cond-assign
  while (arg = cmdLine.shift()) {
    if (arg.length < 2 || !arg.startsWith("-") && !arg.startsWith("/")) {
      continue;
    }

    switch (arg.charAt(1)) {
      case "D": {
        let define: Define = Define.fromArgument(arg.substring(2));
        config.defines.set(define.key, define);
        continue;
      }
      case "I":
        config.includes.add(FilePath.fromUnixy(arg.substring(2)));
        continue;
    }

    if (arg === forceIncludeArg) {
      let include: string | undefined = cmdLine.shift();
      if (typeof include === "string") {
        config.forcedIncludes.add(FilePath.fromUnixy(include));
      }
      continue;
    }
  }

  return config;
}

function parseCompilerDefaults(output: string[], defaults: CompilerDefaults): void {
  let inIncludes = false;
  let inSysIncludes = false;

  for (let line of output) {
    if (inIncludes) {
      if (line.startsWith(" ")) {
        let include: string = line.trim();
        if (include.endsWith(FRAMEWORK_MARKER)) {
          let path = FilePath.fromPath(
            include.substring(0, include.length - FRAMEWORK_MARKER.length),
          );
          defaults.osxFrameworkIncludes.add(path);
        } else if (inSysIncludes) {
          defaults.sysIncludes.add(FilePath.fromPath(include));
        } else {
          defaults.includes.add(FilePath.fromPath(include));
        }
        continue;
      } else {
        inIncludes = false;
      }
    }

    if (line.startsWith("#include ")) {
      inIncludes = true;
      inSysIncludes = line.charAt(9) === "<";
    } else if (line.startsWith("#define ")) {
      let define: Define = Define.fromCode(line.substring(8).trim());
      defaults.defines.set(define.key, define);
    }
  }
}

export interface CompilerState {
  fileType: FileType;
  command: CmdArg[];
  override: CmdArg[] | undefined;
  compiler: string;

  intelliSenseMode: INTELLISENSE_MODES;
  standard: string;
  version: string;
  windowsSdkVersion: string | undefined;
  osxSdk: FilePath | undefined;

  includes: FilePath[];
  sysIncludes: FilePath[];
  osxFrameworkIncludes: FilePath[];
  defines: number;
}

export abstract class Compiler implements Disposable, StateProvider {
  protected srcdir: FilePath;
  protected command: CmdArg[];
  protected type: FileType;
  protected settings: CompilerSettings;
  protected defaults: CompilerDefaults;

  protected constructor(
    srcdir: FilePath,
    command: CmdArg[],
    type: FileType,
    settings: CompilerSettings,
    defaults: CompilerDefaults,
  ) {
    this.srcdir = srcdir;
    this.command = command;
    this.type = type;
    this.settings = settings;
    this.defaults = defaults;
  }

  public dispose(): void {
    // Nothing to do.
  }

  public async toState(): Promise<CompilerState> {
    return {
      fileType: this.type,
      command: this.command,
      override: await config.getCompiler(this.srcdir.toUri(), this.type),
      compiler: "unknown",

      intelliSenseMode: this.settings.intelliSenseMode,
      standard: this.settings.standard,
      version: this.settings.version,
      windowsSdkVersion: this.settings.windowsSdkVersion,
      osxSdk: this.settings.osxSdk,

      includes: Array.from(this.defaults.includes),
      sysIncludes: Array.from(this.defaults.sysIncludes),
      osxFrameworkIncludes: Array.from(this.defaults.osxFrameworkIncludes),
      defines: this.defaults.defines.size,
    };
  }

  public static async create(
    srcdir: FilePath,
    command: CmdArg[],
    type: FileType,
    config: Map<string, string>,
  ): Promise<Compiler> {
    let compilerType: string | undefined = config.get("CC_TYPE");
    if (!compilerType) {
      throw new Error("Unable to determine compiler types.");
    }

    switch (compilerType) {
      case "clang":
        return ClangCompiler.fetch(srcdir, command, type, config);
      case "clang-cl":
      case "msvc":
        return MsvcCompiler.fetch(srcdir, command, type, compilerType);
      default:
        throw new Error(`Unknown compiler type ${compilerType}.`);
    }
  }

  public async getCommand(): Promise<CmdArg[]> {
    return await config.getCompiler(this.srcdir.toUri(), this.type) ?? this.command.slice(0);
  }

  public getIncludePaths(): FilePathSet {
    let includes: FilePathSet = new FilePathSet();
    function addIncludes(set: FilePathSet): void {
      for (let include of set) {
        includes.add(include);
      }
    }

    addIncludes(this.defaults.sysIncludes);
    addIncludes(this.defaults.includes);
    addIncludes(this.defaults.osxFrameworkIncludes);

    return includes;
  }

  public abstract getSourceConfigForArguments(cmdLine: string[]): Promise<SourceFileConfiguration>;

  public abstract compile(source: FilePath, cmdLine: string[]): Promise<ProcessResult>;
}

class ClangCompiler extends Compiler {
  public dispose(): void {
    super.dispose();
  }

  public async toState(): Promise<CompilerState> {
    return {
      ...await super.toState(),
      compiler: "clang",
    };
  }

  public static async fetch(
    srcdir: FilePath,
    command: CmdArg[],
    type: FileType,
    buildConfig: Map<string, string>,
  ): Promise<Compiler> {
    let defaults: CompilerDefaults = {
      includes: new FilePathSet(),
      sysIncludes: new FilePathSet(),
      osxFrameworkIncludes: new FilePathSet(),
      defines: new Map(),
    };

    let settings: CompilerSettings = {
      intelliSenseMode: "clang-x64",
      standard: type === FileType.C ? C_STANDARD : CPP_STANDARD,
      version: type === FileType.C ? C_VERSION : CPP_VERSION,
    };

    if (process.platform === "darwin") {
      let sdk: string | undefined = buildConfig.get("MACOS_SDK_DIR");
      if (sdk) {
        settings.osxSdk = FilePath.fromUnixy(sdk);
      }
    }

    let compiler: Compiler = new ClangCompiler(srcdir, command, type, settings, defaults);

    let runCmd: CmdArg[] = await compiler.getCommand();
    runCmd.push(`-std=${settings.version}`, type === FileType.C ? "-xc" : "-xc++");

    if (process.platform === "darwin" && settings.osxSdk) {
      runCmd.push("-isysroot", settings.osxSdk);
    }

    runCmd.push("-Wp,-v", "-E", "-dD", "/dev/null");

    try {
      let result: ProcessResult = await exec(runCmd);

      parseCompilerDefaults(result.output, defaults);

      if (defaults.defines.size === 0) {
        throw new Error("Failed to discover compiler defaults.");
      }

      return compiler;
    } catch (e) {
      log.error("Failed to get compiler defaults", e);
      throw e;
    }
  }

  public getSourceConfigForArguments(cmdLine: string[]): Promise<SourceFileConfiguration> {
    let fileConfig: FileConfig = getFileConfigForArguments(cmdLine, "-include");

    let config: SourceFileConfiguration = {
      includePath: pathsAsArray(
        this.defaults.sysIncludes,
        this.defaults.includes,
        this.defaults.osxFrameworkIncludes,
        fileConfig.includes,
        fileConfig.osxFrameworkIncludes,
      ),
      defines: definesAsArray(this.defaults.defines, fileConfig.defines),
      forcedInclude: pathsAsArray(fileConfig.forcedIncludes),
      intelliSenseMode: this.settings.intelliSenseMode,
      standard: this.settings.standard as VERSIONS,
    };

    return Promise.resolve(config);
  }

  public async compile(source: FilePath, cmdLine: string[]): Promise<ProcessResult> {
    let fileConfig: FileConfig = getFileConfigForArguments(cmdLine, "-include");

    let command: CmdArg[] = await this.getCommand();
    if (this.settings.osxSdk) {
      command.push("-isysroot", this.settings.osxSdk.toPath());
    }

    command.push(
      `-std=${this.settings.version}`,
      this.type === FileType.C ?
        "-xc" :
        "-xc++",
      "-c",
      "-Wno-everything",
    );

    for (let define of fileConfig.defines.values()) {
      command.push(`-D${define}`);
    }

    for (let include of fileConfig.includes) {
      command.push(`-I${include.toPath()}`);
    }

    if (process.platform === "darwin") {
      for (let include of fileConfig.osxFrameworkIncludes) {
        command.push("-framework", `${include.toPath()}`);
      }
    }

    for (let include of fileConfig.forcedIncludes) {
      command.push("-include", include.toPath());
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

  public async toState(): Promise<CompilerState> {
    return {
      ...await super.toState(),
      compiler: "clang-cl",
    };
  }

  public static async fetch(
    srcdir: FilePath,
    command: CmdArg[],
    type: FileType,
    compilerType: string,
  ): Promise<Compiler> {
    if (compilerType === "msvc") {
      throw new Error("The msvc compiler is currently not supported.");
    }

    let defaults: CompilerDefaults = {
      includes: new FilePathSet(),
      sysIncludes: new FilePathSet(),
      osxFrameworkIncludes: new FilePathSet(),
      defines: new Map(),
    };

    let settings: CompilerSettings = {
      intelliSenseMode: compilerType === "msvc" ? "msvc-x64" : "clang-x64",
      standard: type === FileType.C ? C_STANDARD : CPP_STANDARD,
      version: type === FileType.C ? C_VERSION : CPP_VERSION,
    };

    let compiler: Compiler = new MsvcCompiler(srcdir, command, type, settings, defaults);

    let runCmd: CmdArg[] = await compiler.getCommand();
    runCmd.push(`-std:${settings.version}`, type === FileType.C ? "-TC" : "-TP");

    runCmd.push("-v", "-E", "-Xclang", "-dM", "/dev/null");

    try {
      let result: ProcessResult = await exec(runCmd);

      parseCompilerDefaults(result.output, defaults);

      if (defaults.defines.size === 0) {
        throw new Error("Failed to discover compiler defaults.");
      }

      return compiler;
    } catch (e) {
      log.error("Failed to get compiler defaults", e);
      throw e;
    }
  }

  public async getSourceConfigForArguments(cmdLine: string[]): Promise<SourceFileConfiguration> {
    let fileConfig: FileConfig = getFileConfigForArguments(cmdLine, "-FI");

    // We rely on cpptools getting the defaults from clang-cl here. We must also use msvc
    // intellisense mode or cpptools thinks we are a WSL compiler.
    let config: SourceFileConfiguration = {
      includePath: pathsAsArray(fileConfig.includes),
      defines: definesAsArray(fileConfig.defines),
      forcedInclude: pathsAsArray(fileConfig.forcedIncludes),
      intelliSenseMode: "msvc-x64",
      standard: this.settings.standard as VERSIONS,
      compilerPath: shellQuote(
        (await this.getCommand()).map((i: string | FilePath): string => i.toString()),
      ),
    };

    return config;
  }

  public async compile(source: FilePath, cmdLine: string[]): Promise<ProcessResult> {
    let fileConfig: FileConfig = getFileConfigForArguments(cmdLine, "-FI");

    let command: CmdArg[] = await this.getCommand();
    command.push(
      `-std:${this.settings.version}`,
      this.type === FileType.C ? "-TC" : "-TP",
      "-c",
      "-W0",
    );

    for (let define of fileConfig.defines.values()) {
      command.push(`-D${define}`);
    }

    for (let include of fileConfig.includes) {
      command.push(`-I${include.toPath()}`);
    }

    for (let include of fileConfig.forcedIncludes) {
      command.push("-FI", include.toPath());
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
