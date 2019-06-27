# Mozilla C++ intellisense provider for Visual Studio Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/fractalbrew.mozillacpp.svg?style=popout)](https://marketplace.visualstudio.com/items?itemName=fractalbrew.mozillacpp)
[![Blocking issues](https://img.shields.io/github/issues-raw/fractalbrew/vscode-mozillacpp/blocking.svg?style=popout)](https://github.com/FractalBrew/vscode-mozillacpp/issues?q=is%3Aopen+is%3Aissue+label%3Ablocking)
[![Open issues](https://img.shields.io/github/issues-raw/fractalbrew/vscode-mozillacpp.svg?style=popout)](https://github.com/FractalBrew/vscode-mozillacpp/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr-raw/fractalbrew/vscode-mozillacpp.svg?style=popout)](https://github.com/FractalBrew/vscode-mozillacpp/pulls)

With generated headers, external build directories and a non-standard build
configuration it is near impossible for standard tools to understand Mozilla's
build graph.

This Visual Studio Code extension provides the additional knowledge needed. It
is built as an extension to the official [C/C++ extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools).

This extension should be considered an early release, please [file issues](https://github.com/FractalBrew/vscode-mozillacpp/issues/new)
where Visual Studio Code doesn't understand your code as you find them.

## Requirements

1. [The C/C++ extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools).
2. You need to be compiling with clang (or something that behaves the same).

## Usage

Once installed and configured you should be seeing potential issues in your code
where symbols can't be resolved.

Since many necessary headers are generated at build time and the build config
is only updated at build time, intellisense data will not work unless you have
built your tree since any applicable changes. For example errors may appear if
you have modified a `moz.build` or `.idl` file since the last build. In some
cases this extension will be able to detect this and warn you that there is an
issue.

## Known issues

Generally check the [Github issues](https://github.com/FractalBrew/vscode-mozillacpp/issues).
The main issue of note is that it seems to [take a while for Visual Studio Code
to catch up with changes to the build configuration](https://github.com/FractalBrew/vscode-mozillacpp/issues/8).
This doesn't appear to be an issue that this extension can do anything about
though.

## Installation

1. Install this extension.
2. Open a folder containing the Mozilla source code (the `mach` script must be
   at the root of the folder).
3. You may see a pop-up offering to configure intellisense automatically, if not
   open the command palette and run `C/C++: Change Configuration Provider` and
   then select `Mozilla` from the options.

## Configuration

* `mozillacpp.<extension>.compiler` overrides the detected compiler for each
  language. Including arguments is not currently supported.
* `mozillacpp.mach.command` overrides the detected `mach`, useful for supplying
  a script to configure your build. Including arguments is not currently
  supported.
* `mozillacpp.mach.env` sets environment variables to use when running `mach`.
  These are merged with the existing process environment.
* `mozillacpp.log.level` sets the log level that will show up in the Output
  panel.
* `mozillacpp.log.show_level` sets a log level that will cause the Output panel
  to appear.
* `mozillacpp.tag.disable` disables the C++ tag parser. The tag parser chews up
  a lot of CPU cycles and provides less accurate results, but it is more
  reliable than intellisense and so will give results when intellisense fails.
