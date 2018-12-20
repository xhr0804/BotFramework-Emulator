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

const launchDetachedEmulator = () => {
  const args = process.argv || [];

  if (!args[0]) {
    return;
  }

  // we want to start the electron app and not run it as a node script
  delete process.env.ELECTRON_RUN_AS_NODE;

  // path to electron exe
  const electronPath = args[0];
  
  // pass args through to app
  const argsToPass = args.slice(1) || [];

  const stdOut = openSync(join(process.cwd(), 'out_log.txt'), 'a');
  const stdErr = openSync(join(process.cwd(), 'err_log.txt'), 'a');
  
  // spawn the detached electron app process
  const child = spawn(
    electronPath,
    argsToPass,
    {
      detached: true,
      stdio: ['ignore', stdOut, stdErr]
    },
  );
  child.unref();
};

launchDetachedEmulator();
