
import * as cpptools from 'vscode-cpptools';
import * as vscode from 'vscode';
const split = require('split-string');

import { WorkspaceFolder } from './folders';
import { Workspace } from './workspace';

const C_VERSION = 'c++11';

function splitCmdLine(cmdline: string): string[] {
  let stripQuotes = (s: string): string => {
    if (s.length < 2) {
      return s;
    }

    if ((s.startsWith('\'') && s.endsWith('\'')) ||
        (s.startsWith('"') && s.endsWith('"'))) {
      return s.substring(1, s.length - 2);
    }

    return s;
  };

  return split(cmdline.trim(), {
    quotes: true,
    separator: ' ',
  }).map(stripQuotes);
}

export class MachConfigurationProvider implements cpptools.CustomConfigurationProvider {
  api: cpptools.CppToolsApi;
  workspace: Workspace;

  name: string = 'Mozilla';
  extensionId: string = 'fractalbrew.mozillacpp';

  public static async create(workspace: Workspace): Promise<MachConfigurationProvider|null> {
    let api = await cpptools.getCppToolsApi(cpptools.Version.v2);
    if (api) {
      return new MachConfigurationProvider(api, workspace);
    }
    return null;
  }

  private constructor(api: cpptools.CppToolsApi, workspace: Workspace) {
    this.api = api;
    this.workspace = workspace;

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

  private showError(message: string) {
    vscode.window.showErrorMessage(message);
  }

  public resetConfiguration() {
    this.api.didChangeCustomConfiguration(this);
  }

  public resetBrowseConfiguration() {
    this.api.didChangeCustomBrowseConfiguration(this);
  }

  private parseConfigFromCmdLine(cmdline: string): cpptools.SourceFileConfiguration {
    let args = splitCmdLine(cmdline);

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
      if (arg.length < 2 || (arg.charAt(0) !== '-' && arg.charAt(0) !== '/')) {
        console.warn(`Skipping unknown argument: ${JSON.stringify(args)}`);
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

      if (arg === '-include') {
        let include = args.shift();
        if (include && configItem.forcedInclude) {
          configItem.forcedInclude.push(include);
        }
        continue;
      }

      if (arg === '-isysroot') {
        args.shift();
      }
    }

    return configItem;
  }


  async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
    try {
      let folder = await this.workspace.getFolder(uri);
      return folder !== undefined && folder.canProvideConfig();
    } catch (e) {
      console.error('mozillacpp: Failed to canProvildeConfiguration.', e);
      return false;
    }
  }

  public async provideConfigurations(uris: vscode.Uri[]): Promise<cpptools.SourceFileConfigurationItem[]> {
    let results: (undefined|cpptools.SourceFileConfigurationItem)[] = await Promise.all(uris.map(async (uri) => {
      try {
        let folder = await this.workspace.getFolder(uri);
        if (!folder || !await folder.canProvideConfig()) {
          return undefined;
        }

        let config = await folder.getCachedConfiguration(uri, async (folder: WorkspaceFolder, path: string): Promise<cpptools.SourceFileConfiguration|undefined> => {
          try {
            let output = await folder.mach(['compileflags', path]);
            try {
              return this.parseConfigFromCmdLine(output.stdout);
            } catch (e) {
              console.error('mozillacpp: Failed to parse command line.', e);
              return undefined;
            }
          } catch (e) {
            if (e.result.stdout.trim() === 'Your tree has not been built yet. Please run |mach build| with no arguments.') {
              this.showError('You must compile before Mozilla Intellisense will work.');
            }
            return undefined;
          }
        });

        if (config === undefined) {
          return config;
        }

        return {
          uri: uri,
          configuration: config,
        };
      } catch (e) {
        console.error('mozillacpp: Failed to generate configuration.', e);
        return undefined;
      }
    }));

    let hasConfig = (item: cpptools.SourceFileConfigurationItem|undefined): item is cpptools.SourceFileConfigurationItem => {
      return item !== undefined;
    };

    return results.filter(hasConfig);
  }

  public async canProvideBrowseConfiguration(): Promise<boolean> {
    try {
      return this.workspace.canProvideConfig();
    } catch (e) {
      console.error('mozillacpp: Failed to canProvideBrowseConfiguration.', e);
      return false;
    }
  }

  public async provideBrowseConfiguration(): Promise<cpptools.WorkspaceBrowseConfiguration> {
    try {
      let folders = await this.workspace.getMachFolders();

      let browsePath: string[] = [];
      let compilerPath: string|undefined = undefined;

      for (let folder of folders) {
        if (!compilerPath) {
          compilerPath = await this.getCompilerPath(folder);
        }

        browsePath.push(folder.getTopSrcDir());
        browsePath.push(folder.getTopObjDir());
      }

      return {
        browsePath,
        compilerPath,
      };
    } catch (e) {
      console.error('mozillacpp: Failed to provideBrowseConfiguration.', e);
      throw(e);
    }
  }

  public dispose() {
    this.api.dispose();
  }

  private async getCompilerPath(folder: WorkspaceFolder): Promise<string|undefined> {
    try {
      let output = await folder.mach(['compileflags', folder.getTopSrcDir()]);
      let args = splitCmdLine(output.stdout);
      if (args.length > 0) {
        return args[0];
      }
    } catch (e) {
      console.error('mozillacpp: Failed to get compiler path.', e);
    }

    return undefined;
  }
}