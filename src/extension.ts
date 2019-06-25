import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
const split = require('split-string');

const C_VERSION = 'c++11';

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

function splitCmd(cmdline: string): string[] {
  return split(cmdline.trim(), {
    quotes: true,
    separator: ' ',
  });
}

let gProvider: ConfigurationProvider | undefined = undefined;

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

function exec(command: string, args: string[], options?: SpawnOptions): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    let process = spawn(command, args, options);

    let output: ProcessOutput = {
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
        reject({
          code,
          ...output
        });
      }
    });
  });
}

interface FileInfo {
  mach: string;
  path: string;
}

class ConfigurationProvider implements cpptools.CustomConfigurationProvider {
  name: string = 'Gecko';
  extensionId: string = 'fractalbrew.geckocpp';

  async canProvideConfiguration(uri: vscode.Uri, token?: any): Promise<boolean> {
    let info = await this.getFileInfo(uri);
    return !!info;
  }

  async provideConfigurations(uris: vscode.Uri[], token?: any): Promise<cpptools.SourceFileConfigurationItem[]> {
    let results = await Promise.all(uris.map((uri) => this.getConfiguration(uri)));

    let hasConfig = (item: cpptools.SourceFileConfigurationItem|null): item is cpptools.SourceFileConfigurationItem => {
      return !!item;
    };

    return results.filter(hasConfig);
  }

  async canProvideBrowseConfiguration(token?: any): Promise<boolean> {
    return true;
  }

  async provideBrowseConfiguration(token?: any): Promise<cpptools.WorkspaceBrowseConfiguration> {
    let folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      throw new Error('No workspace');
    }

    for (let folder of folders) {
      let uri = folder.uri;
      if (uri.scheme !== 'file') {
        continue;
      }

      try {
        let machPath = path.join(uri.fsPath, 'mach');
        let stats = await fsStat(machPath);
        if (stats.isFile()) {
          let output = await this.mach(machPath, ['compileflags', 'toolkit/xre/nsAppRunner.cpp']);
          let args = splitCmd(output.stdout);
          return {
            browsePath: [],
            compilerPath: args.shift(),
            standard: C_VERSION,
          };
        }
      } catch (e) {
        console.error(e);
        continue;
      }
    }

    throw new Error('No workspace folder contained a mach instance.');
  }

  dispose() {
    this.api.dispose();
  }

  // ------

  api: cpptools.CppToolsApi;
  needsCompile: boolean = false;

  constructor(api: cpptools.CppToolsApi) {
    this.api = api;

    if (api.notifyReady) {
      // Inform cpptools that a custom config provider will be able to service the current workspace.
      api.registerCustomConfigurationProvider(this);

      // Notify cpptools that the provider is ready to provide IntelliSense configurations.
      api.notifyReady(this);
    } else {
      // Running on a version of cpptools that doesn't support v2 yet.

      // Inform cpptools that a custom config provider will be able to service the current workspace.
      api.registerCustomConfigurationProvider(this);
      api.didChangeCustomConfiguration(this);
    }
  }

  async getConfiguration(uri: vscode.Uri): Promise<cpptools.SourceFileConfigurationItem|null> {
    let info = await this.getFileInfo(uri);
    if (!info) {
      return null;
    }

    function parseArguments(cmdline: string): cpptools.SourceFileConfiguration {
      let args = splitCmd(cmdline);

      let configItem: cpptools.SourceFileConfiguration = {
        includePath: [],
        defines: [],
        intelliSenseMode: 'clang-x64',
        standard: C_VERSION,
        forcedInclude: [],
        compilerPath: args.shift(),
      };

      let arg;
      while (arg = args.shift()) {
        if (arg.length < 2 || arg.charAt(0) !== "-") {
          console.log(`Skipping unknown argument: ${JSON.stringify(args[0])}`);
          continue;
        }

        switch (arg.charAt(1)) {
          case 'D':
            configItem.defines.push(arg.substring(2));
            continue;
          case 'I':
            configItem.includePath.push(arg.substring(2));
            continue;
        }

        if (arg === "-include") {
          let include = args.shift();
          if (include && configItem.forcedInclude) {
            configItem.forcedInclude.push(include);
          }
          continue;
        }

        if (arg === "-isysroot") {
          args.shift();
        }
      }

      console.log(configItem);
      return configItem;
    }

    let output;
    try {
      output = await this.mach(info.mach, ['compileflags', info.path]);
      console.log(output);
    } catch (output) {
      console.log(output);

      if (!this.needsCompile && output.stdout.trim() === 'Your tree has not been built yet. Please run |mach build| with no arguments.') {
        vscode.window.showErrorMessage('You must compile before Gecko Intellisense will work.');
        this.needsCompile = true;
      }
      return null;
    }

    try {
      return {
        uri,
        configuration: parseArguments(output.stdout),
      };
    } catch (e) {
      console.error(e);
    }

    return null;
  }

  async getFileInfo(uri: vscode.Uri): Promise<FileInfo|null> {
    if (uri.scheme !== 'file') {
      return null;
    }

    let folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return null;
    }

    for (let folder of folders) {
      if (folder.uri.scheme !== 'file') {
        continue;
      }

      if (!uri.fsPath.startsWith(folder.uri.fsPath)) {
        return null;
      }

      let machPath = path.join(folder.uri.fsPath, 'mach');
      try {
        let stats = await fsStat(machPath);
        if (stats.isFile()) {
          return { mach: machPath, path: uri.fsPath };
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  async mach(mach: string, args: string[]): Promise<ProcessOutput> {
    let config = vscode.workspace.getConfiguration('geckocpp');

    let cwd = path.dirname(mach);
    let command: string = config.get('mach') || mach;

    let env = Object.assign({}, config.get('mach_env') || {}, process.env);

    console.log(`${command} ${args.join(' ')}`);
    return exec(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
  }

  resetIntellisense() {
    this.api.didChangeCustomConfiguration(this);
    this.api.didChangeCustomBrowseConfiguration(this);
  }
}

async function workspaceChanged(event: vscode.WorkspaceFoldersChangeEvent) {
  if (gProvider || event.added.length === 0) {
    return;
  }

  checkFolders();
}

async function checkFolders(): Promise<boolean> {
  if (gProvider) {
    return true;
  }

  let folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return false;
  }

  for (let folder of folders) {
    let uri = folder.uri;
    if (uri.scheme !== 'file') {
      continue;
    }

    try {
      let stats = await fsStat(path.join(uri.fsPath, 'mach'));
      if (stats.isFile()) {
        let api = await cpptools.getCppToolsApi(cpptools.Version.v2);
        if (api) {
          gProvider = new ConfigurationProvider(api);
        }

        return true;
      }
    } catch (e) {
      continue;
    }
  }

  return false;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('geckocpp.resetIntellisense', () => {
      if (gProvider) {
        gProvider.resetIntellisense();
      }
    })
  );

  if (!await checkFolders()) {
    vscode.workspace.onDidChangeWorkspaceFolders(workspaceChanged);
  }
}

export function deactivate() {
  if (gProvider) {
    gProvider.dispose();
  }
}
