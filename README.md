# Mozilla C++ intellisense provider for Visual Studio Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/fractalbrew.mozillacpp.svg?style=popout)](https://marketplace.visualstudio.com/items?itemName=fractalbrew.mozillacpp)
[![Blocking issues](https://img.shields.io/github/issues-raw/fractalbrew/vscode-mozillacpp/blocking.svg?style=popout)](https://github.com/FractalBrew/vscode-mozillacpp/issues?q=is%3Aopen+is%3Aissue+label%3Ablocking)
[![Open issues](https://img.shields.io/github/issues-raw/fractalbrew/vscode-mozillacpp.svg?style=popout)](https://github.com/FractalBrew/vscode-mozillacpp/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr-raw/fractalbrew/vscode-mozillacpp.svg?style=popout)](https://github.com/FractalBrew/vscode-mozillacpp/pulls)

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

* `mozillacpp.compiler.c` and `mozillacpp.compiler.cpp` overrides the detected compiler for each language.
* `mozillacpp.mach` overrides the detected `mach`, useful for supplying a script to configure your build.
* `mozillacpp.mach_env` sets environment variables to use when running `mach`. These are merged with the existing process environment.
* `mozillacpp.log_level` sets the log level that will show up in the Output panel.
* `mozillacpp.log_show_level` sets a log level that will cause the Output panel to appear.
* `mozillacpp.tag.disable` disables the C++ tag parser. The tag parser chews up a lot of CPU cycles and provides less accurate results, but it is more reliable than intellisense so will give results when that fails.
