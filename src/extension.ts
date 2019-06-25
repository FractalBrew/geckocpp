import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import { spawn, SpawnOptions } from 'child_process';

let gProvider: ConfigurationProvider | undefined = undefined;

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

function exec(command: string, args: string[], options?: SpawnOptions | undefined): Promise<ProcessOutput> {
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
        reject(output);
      }
    });
  });
}

class ConfigurationProvider implements cpptools.CustomConfigurationProvider {
  name: string = "Gecko";
  extensionId: string = "vscode-geckocpp";

  async canProvideConfiguration(uri: vscode.Uri, token?: any): Promise<boolean> {
    console.log('canProvideConfiguration');
    return false;
  }

  async provideConfigurations(uris: vscode.Uri[], token?: any): Promise<cpptools.SourceFileConfigurationItem[]> {
    console.log('provideConfigurations');
    return [];
  }

  async canProvideBrowseConfiguration(token?: any): Promise<boolean> {
    console.log('canProvideBrowseConfiguration');
    return false;
  }

  async provideBrowseConfiguration(token?: any): Promise<cpptools.WorkspaceBrowseConfiguration> {
    console.log('provideBrowseConfiguration');
    throw new Error("Method not implemented.");
  }

  dispose() {
    this.api.dispose();
  }

  // ------

  api: cpptools.CppToolsApi;
  checked: boolean = false;

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

  resetIntellisense() {
    console.log('Reset');
    this.api.didChangeCustomConfiguration(this);
    this.api.didChangeCustomBrowseConfiguration(this);
  }
}

async function foldersChanged(event: vscode.WorkspaceFoldersChangeEvent) {
  if (gProvider || event.added.length === 0) {
    return;
  }

  checkFolders();
}

async function checkFolders(): Promise<boolean> {
  if (gProvider) {
    return true;
  }

  let machs = await vscode.workspace.findFiles('mach', null, 1);
  if (machs.length > 0) {
    let api = await cpptools.getCppToolsApi(cpptools.Version.v2);
    if (api) {
      gProvider = new ConfigurationProvider(api);
    }

    return true;
  }

  return false;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  console.log("Extension loaded.");
  context.subscriptions.push(
    vscode.commands.registerCommand('geckocpp.resetIntellisense', () => {
      if (gProvider) {
        gProvider.resetIntellisense();
      }
    })
  );

  if (!await checkFolders()) {
    vscode.workspace.onDidChangeWorkspaceFolders(foldersChanged);
  }
}

export function deactivate() {
  if (gProvider) {
    gProvider.dispose();
  }
}
