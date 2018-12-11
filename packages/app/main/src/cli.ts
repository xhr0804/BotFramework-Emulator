//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Framework Emulator Github:
// https://github.com/Microsoft/BotFramwork-Emulator
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import { spawn } from 'child_process';
import { join } from 'path';
import { openSync } from 'fs-extra';

const startEmulator = () => {
  const args = process.argv || [];
  // console.log('got args: ', args);

  if (!args[0]) {
    console.log('no args');
    return;
  }

  // path to electron exe
  const electronPath = args[0];
  console.log('ELECTRON PATH: ', electronPath);
  // path to app entry point
  const main = join(__dirname, 'main.js');
  console.log('MAIN PATH: ', main);
  // pass args to app (prune '.' from end; will be replaced with path to entry point)
  const argsToPass = args.slice(1, args.length - 1) || [];
  console.log('args to pass: ', argsToPass);

  console.log('DIRNAME: ', __dirname);
  console.log('CWD: ', process.cwd());

  // const out = openSync(join(process.cwd(), './out.log'), 'a');
  // const err = openSync(join(process.cwd(), './err.log'), 'a');
  
  console.log('spawning sub process');
  const child = spawn(
    electronPath,
    [
      ...argsToPass,
      main
    ],
    {
      detached: true,
      stdio: 'ignore' // ['ignore', out, err]
    }
  );
  child.unref();
  console.log('should now be running in detached mode');
};

startEmulator();
