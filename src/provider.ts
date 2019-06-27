/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as cpptools from 'vscode-cpptools';
import * as vscode from 'vscode';

import { WorkspaceFolder, ProcessResult } from './folders';
import { Workspace } from './workspace';
import { log } from './logging';
import { parseConfigFromCmdLine, CompilerInfo } from './shared';

export class MachConfigurationProvider implements cpptools.CustomConfigurationProvider {
  api: cpptools.CppToolsApi;
  workspace: Workspace;

  name: string = 'Mozilla';
  extensionId: string = 'fractalbrew.mozillacpp';

  public static async create(workspace: Workspace): Promise<MachConfigurationProvider|null> {
    let api: cpptools.CppToolsApi|undefined = await cpptools.getCppToolsApi(cpptools.Version.v2);
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

  private showError(message: string): void {
    vscode.window.showErrorMessage(message);
  }

  public resetConfiguration(): void {
    this.api.didChangeCustomConfiguration(this);
  }

  public resetBrowseConfiguration(): void {
    this.api.didChangeCustomBrowseConfiguration(this);
  }

  async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
    try {
      let folder: WorkspaceFolder|undefined = await this.workspace.getFolder(uri);
      return folder !== undefined && folder.canProvideConfig();
    } catch (e) {
      log.error('Failed to canProvildeConfiguration.', e);
      return false;
    }
  }

  private async getConfiguration(folder: WorkspaceFolder, compilerInfo: CompilerInfo, path: string): Promise<cpptools.SourceFileConfiguration|undefined> {
    try {
      let output: ProcessResult = await folder.mach(['compileflags', path]);
      try {
        return parseConfigFromCmdLine(compilerInfo, output.stdout);
      } catch (e) {
        log.error('Failed to parse command line.', e);
        return undefined;
      }
    } catch (e) {
      if (e.result.stdout.trim() === 'Your tree has not been built yet. Please run |mach build| with no arguments.') {
        this.showError('You must compile before Mozilla Intellisense will work.');
      }
      return undefined;
    }
  }

  public async provideConfigurations(uris: vscode.Uri[]): Promise<cpptools.SourceFileConfigurationItem[]> {
    let results: (undefined|cpptools.SourceFileConfigurationItem)[] = await Promise.all(uris.map(async (uri) => {
      try {
        let folder: WorkspaceFolder|undefined = await this.workspace.getFolder(uri);
        if (!folder || !await folder.canProvideConfig()) {
          return undefined;
        }

        let config: cpptools.SourceFileConfiguration|undefined = await folder.getCachedConfiguration(uri, this.getConfiguration.bind(this));

        if (config === undefined) {
          log.debug(`Unable to find configuration for ${uri.fsPath}.`);
          return config;
        }

        log.debug(`Returning configuration for ${uri.fsPath}.`, config);

        return {
          uri: uri,
          configuration: config,
        };
      } catch (e) {
        log.error('Failed to generate configuration.', e);
        return undefined;
      }
    }));

    function hasConfig(item: cpptools.SourceFileConfigurationItem|undefined): item is cpptools.SourceFileConfigurationItem {
      return item !== undefined;
    }

    return results.filter(hasConfig);
  }

  public async canProvideBrowseConfiguration(): Promise<boolean> {
    try {
      return this.workspace.canProvideConfig();
    } catch (e) {
      log.error('Failed to canProvideBrowseConfiguration.', e);
      return false;
    }
  }

  public async provideBrowseConfiguration(): Promise<cpptools.WorkspaceBrowseConfiguration> {
    let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('mozillacpp');
    if (config.get('tag.disable')) {
      log.debug('Disabling browse path.');
      return {
        browsePath: [],
      };
    }

    try {
      let folders: WorkspaceFolder[] = await this.workspace.getMachFolders();

      let browsePath: Set<string> = new Set();

      for (let folder of folders) {
        for (let path of folder.getIncludePaths()) {
          browsePath.add(path);
        }

        browsePath.add(folder.getTopSrcDir());
        browsePath.add(folder.getTopObjDir());
      }

      let config: cpptools.WorkspaceBrowseConfiguration = {
        browsePath: Array.from(browsePath),
      };

      log.debug('Returning browse configuration.', config);
      return config;
    } catch (e) {
      log.error('Failed to provideBrowseConfiguration.', e);
      throw(e);
    }
  }

  public dispose(): void {
    this.api.dispose();
  }
}