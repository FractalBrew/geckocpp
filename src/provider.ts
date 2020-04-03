/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as vscode from "vscode";
import * as cpptools from "vscode-cpptools";

import { SourceFolder } from "./folders";
import { logItem, log } from "./logging";
import { Disposable, FilePathSet, FilePath } from "./shared";
import { Workspace } from "./workspace";

export class MachConfigurationProvider implements cpptools.CustomConfigurationProvider, Disposable {
  private api: cpptools.CppToolsApi;
  private workspace: Workspace;

  public name = "Mozilla";
  public extensionId = "fractalbrew.mozillacpp";

  public static async create(workspace: Workspace): Promise<MachConfigurationProvider | null> {
    let api: cpptools.CppToolsApi | undefined = await cpptools.getCppToolsApi(cpptools.Version.v3);
    if (api) {
      return new MachConfigurationProvider(api, workspace);
    }
    return null;
  }

  private constructor(api: cpptools.CppToolsApi, workspace: Workspace) {
    this.api = api;
    this.workspace = workspace;

    // Inform cpptools that a custom config provider will be able to service the current workspace.
    api.registerCustomConfigurationProvider(this);

    // Notify cpptools that the provider is ready to provide IntelliSense configurations.
    api.notifyReady(this);
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

  public async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
    try {
      let folder: SourceFolder | undefined = await this.workspace.getFolder(uri);
      return folder?.isMozillaSource() ?? false;
    } catch (e) {
      log.error("Failed to canProvideConfiguration.", e);
      return false;
    }
  }

  public async provideConfigurations(uris: vscode.Uri[]):
  Promise<cpptools.SourceFileConfigurationItem[]> {
    let start: number = Date.now();
    let buildConfig = async(uri: vscode.Uri):
    Promise<undefined | cpptools.SourceFileConfigurationItem> => {
      log.debug(`Configuration for ${uri} requested`);
      try {
        let folder: SourceFolder | undefined = await this.workspace.getFolder(uri);
        if (!folder || !folder.isMozillaSource()) {
          log.warn(`Asked for a configuration for a non-Mozilla file: ${uri.fsPath}`);
          return undefined;
        }

        let compileConfig: cpptools.SourceFileConfiguration | undefined =
          await folder.getSourceConfiguration(uri);
        if (compileConfig === undefined) {
          log.warn(`Unable to find configuration for ${uri.fsPath}.`);
          return undefined;
        }

        let config: cpptools.SourceFileConfiguration = compileConfig;

        log.debug(`Returning configuration for ${uri.fsPath}:`, logItem((): string => "\n" +
`includePath: ${JSON.stringify(config.includePath, null, 2)}
defines: ${config.defines.length}
intelliSenseMode: ${config.intelliSenseMode}
standard: ${config.standard}
forcedInclude: ${JSON.stringify(config.forcedInclude, null, 2)}
compilerPath: ${config.compilerPath}
windowsSdkVersion: ${config.windowsSdkVersion}`
  .split("\n").map((s: string): string => "  " + s).join("\n"), config));

        return {
          uri: uri,
          configuration: config,
        };
      } catch (e) {
        log.error("Failed to generate configuration.", e);
        return undefined;
      }
    };

    function hasConfig(item: cpptools.SourceFileConfigurationItem | undefined):
    item is cpptools.SourceFileConfigurationItem {
      return item !== undefined;
    }

    let results = await Promise.all(uris.map(buildConfig));
    log.debug(`Returned custom configurations in ${Date.now() - start}ms`);
    return results.filter(hasConfig);
  }

  public async canProvideBrowseConfiguration(): Promise<boolean> {
    try {
      return this.workspace.canProvideConfig();
    } catch (e) {
      log.error("Failed to canProvideBrowseConfiguration.", e);
      return false;
    }
  }

  public async provideBrowseConfiguration(): Promise<cpptools.WorkspaceBrowseConfiguration> {
    let start: number = Date.now();
    try {
      let folders: SourceFolder[] = await this.workspace.getMozillaFolders();

      let browsePath: FilePathSet = new FilePathSet();

      for (let folder of folders) {
        for (let path of folder.getIncludePaths()) {
          browsePath.add(path);
        }
      }

      let config: cpptools.WorkspaceBrowseConfiguration = {
        browsePath: Array.from(browsePath).map((p: FilePath): string => p.toPath()),
      };

      log.debug(`Returned browse configuration in ${Date.now() - start}ms`, config);
      return config;
    } catch (e) {
      log.error("Failed to provideBrowseConfiguration.", e);
      throw e;
    }
  }

  public async canProvideBrowseConfigurationsPerFolder(): Promise<boolean> {
    try {
      return this.workspace.canProvideConfig();
    } catch (e) {
      log.error("Failed to canProvideBrowseConfigurationsPerFolder.", e);
      return false;
    }
  }

  public async provideFolderBrowseConfiguration(uri: vscode.Uri):
  Promise<cpptools.WorkspaceBrowseConfiguration> {
    let start: number = Date.now();
    try {
      let folder: SourceFolder | undefined = await this.workspace.getFolder(uri);
      if (!folder || !folder.isMozillaSource()) {
        log.warn(`Asked for a configuration for a non-Mozilla folder: ${uri.fsPath}`);
        return { browsePath: [] };
      }

      let config: cpptools.WorkspaceBrowseConfiguration = {
        browsePath: Array.from(folder.getIncludePaths()).map((p: FilePath): string => p.toPath()),
      };

      log.debug(`Returned folder browse configuration in ${Date.now() - start}ms`, config);
      return config;
    } catch (e) {
      log.error("Failed to provideFolderBrowseConfiguration.", e);
      throw e;
    }
  }

  public dispose(): void {
    this.api.dispose();
  }
}