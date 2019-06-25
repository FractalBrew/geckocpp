# Mozilla C++ intellisense provider for Visual Studio Code

With generated headers, external build directories and a non-standard build
configuration it is near impossible for standard tools to understand Mozilla's build graph.

This Visual Studio Code extension provides the additional knowledge needed. It is build as an extension to the official [C/C++ extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools).

## Installation

1. Ensure that you have installed the [C/C++ extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools).
2. Install this extension.
3. Open a folder containing the Mozilla source code (the `mach` script must be at the root of the folder).
4. You may see a pop up offering to configure intellisense automatically, if not open the command palette and run `C/C++: Change Configuration Provider` and select `Mozilla` from the options.

## Usage

Since many necessary headers are located in the object directory and the build
config is generated/updated at build time, intellisense data is not available
unless you have already built your tree. Some data may be incorrect if you have
modified a `moz.build` file since the last build. This extension will attempt to
identify both cases and warn you accordingly.

## Configuration

The only configuration options available at this time control the execution of
`mach`. If for some reason you want to use a different `mach` to that in the
source code (maybe a script to set some things up) you can provide one. You can
also provide environment variables to whatever is run as `mach`.
