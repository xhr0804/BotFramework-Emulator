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

import * as path from 'path';

import { newBot, newEndpoint, SharedConstants } from '@bfemulator/app-shared';
import { Conversation, Users } from '@bfemulator/emulator-core';
import { BotConfigWithPath, Command, CommandServiceImpl, CommandServiceInstance } from '@bfemulator/sdk-shared';
import * as fs from 'fs-extra';
import { sync as mkdirpSync } from 'mkdirp';

import * as BotActions from '../data/actions/botActions';
import { getStore } from '../data/store';
import { BotHelpers } from '../botHelpers';
import { Emulator } from '../emulator';
import { emulatorApplication } from '../main';
import { dispatch, getStore as getSettingsStore } from '../settingsData/store';
import { parseActivitiesFromChatFile, readFileSync, showSaveDialog, writeFile } from '../utils';
import { cleanupId as cleanupActivityChannelAccountId, CustomActivity } from '../utils/conversation';
import { botProjectFileWatcher } from '../watchers';
import { TelemetryService } from '../telemetry';
import { setCurrentUser } from '../settingsData/actions/userActions';
import { pushClientAwareSettings } from '../settingsData/actions/frameworkActions';
import { ProtocolHandler } from '../protocolHandler';
import { CredentialManager } from '../credentialManager';

const Commands = SharedConstants.Commands.Emulator;

/** Registers emulator (actual conversation emulation logic) commands */
export class EmulatorCommands {
  @CommandServiceInstance()
  private commandService: CommandServiceImpl;
  // ---------------------------------------------------------------------------
  // Saves the conversation to a transcript file, with user interaction to set filename.
  @Command(Commands.SaveTranscriptToFile)
  protected async saveTranscriptToFile(valueTypes: number, conversationId: string): Promise<void> {
    const activeBot: BotConfigWithPath = BotHelpers.getActiveBot();
    const conversation = Emulator.getInstance().framework.server.botEmulator.facilities.conversations.conversationById(
      conversationId
    );
    if (!conversation) {
      throw new Error(`${Commands.SaveTranscriptToFile}: Conversation ${conversationId} not found.`);
    }
    let botInfo = activeBot ? BotHelpers.getBotInfoByPath(activeBot.path) : {};

    const filename = showSaveDialog(emulatorApplication.mainWindow.browserWindow, {
      // TODO - Localization
      filters: [
        {
          name: 'Transcript Files',
          extensions: ['transcript'],
        },
      ],
      defaultPath: BotHelpers.getTranscriptsPath(activeBot, conversation),
      showsTagField: false,
      title: 'Save conversation transcript',
      buttonLabel: 'Save',
    });

    if (filename && filename.length) {
      mkdirpSync(path.dirname(filename));
      const transcripts = await conversation.getTranscript(valueTypes);
      writeFile(filename, transcripts);
      TelemetryService.trackEvent('transcript_save');
    }

    if (!activeBot) {
      return;
    }

    // If there is no current bot directory, we should set the directory
    // that the transcript is saved in as the bot directory, copy the botfile over,
    // change the bots.json entry, and watch the directory.
    const store = getStore();
    const { currentBotDirectory } = store.getState().bot;
    if (!currentBotDirectory && filename && filename.length) {
      const secret = await CredentialManager.getPassword(activeBot.path);
      const saveableBot = BotHelpers.toSavableBot(activeBot, secret);
      const botDirectory = path.dirname(filename);
      const botPath = path.join(botDirectory, `${activeBot.name}.bot`);
      botInfo = { ...botInfo, path: botPath };

      await saveableBot.save(botPath);
      await BotHelpers.patchBotsJson(botPath, botInfo);
      await botProjectFileWatcher.watch(botPath);
      store.dispatch(BotActions.setDirectory(botDirectory));
    }
  }

  // ---------------------------------------------------------------------------
  // Feeds a transcript from disk to a conversation
  @Command(Commands.FeedTranscriptFromDisk)
  protected async fedTranscriptFromDisk(conversationId: string, botId: string, userId: string, filePath: string) {
    const transcriptPath = path.resolve(filePath);
    const stat = await fs.stat(transcriptPath);

    if (!stat || !stat.isFile()) {
      throw new Error(`${Commands.FeedTranscriptFromDisk}: File ${filePath} not found.`);
    }

    const activities = JSON.parse(readFileSync(transcriptPath));

    await this.commandService.call(Commands.FeedTranscriptFromMemory, conversationId, botId, userId, activities);

    const { name, ext } = path.parse(transcriptPath);
    const fileName = `${name}${ext}`;

    return {
      fileName,
      filePath,
    };
  }

  // ---------------------------------------------------------------------------
  // Feeds a deep-linked transcript (array of parsed activities) to a conversation
  @Command(Commands.FeedTranscriptFromMemory)
  protected feedTranscriptFromMemory(
    conversationId: string,
    botId: string,
    userId: string,
    activities: CustomActivity[]
  ): void {
    const activeBot: BotConfigWithPath = BotHelpers.getActiveBot();

    if (!activeBot) {
      throw new Error('emulator:feed-transcript:deep-link: No active bot.');
    }

    const convo = Emulator.getInstance().framework.server.botEmulator.facilities.conversations.conversationById(
      conversationId
    );
    if (!convo) {
      throw new Error(`emulator:feed-transcript:deep-link: Conversation ${conversationId} not found.`);
    }

    activities = cleanupActivityChannelAccountId(activities, botId, userId);
    convo.feedActivities(activities);
  }

  // ---------------------------------------------------------------------------
  // Get a speech token
  @Command(Commands.GetSpeechToken)
  protected getSpeechToken(endpointId: string, refresh: boolean) {
    const endpoint = Emulator.getInstance().framework.server.botEmulator.facilities.endpoints.get(endpointId);

    return endpoint && endpoint.getSpeechToken(refresh);
  }

  // ---------------------------------------------------------------------------
  // Creates a new conversation object for transcript
  @Command(Commands.NewTranscript)
  protected newTranscript(conversationId: string): Conversation {
    // get the active bot or mock one
    let bot: BotConfigWithPath = BotHelpers.getActiveBot();

    if (!bot) {
      bot = newBot();
      bot.services.push(newEndpoint());
      getStore().dispatch(BotActions.mockAndSetActive(bot));
    }
    const emulator = Emulator.getInstance();
    // TODO: Move away from the .users state on legacy emulator settings, and towards per-conversation users
    return emulator.framework.server.botEmulator.facilities.conversations.newConversation(
      emulator.framework.server.botEmulator,
      null,
      { id: getSettingsStore().getState().users.currentUserId, name: 'User' },
      conversationId
    );
  }

  // ---------------------------------------------------------------------------
  // Open the chat file in a tabbed document as a transcript
  @Command(Commands.OpenChatFile)
  protected async openChatFile(filePath: string): Promise<{ activities: CustomActivity[]; fileName: string }> {
    try {
      const activities = await parseActivitiesFromChatFile(filePath);
      const { name, ext } = path.parse(filePath);
      const fileName = `${name}${ext}`;
      return { activities, fileName };
    } catch (err) {
      throw new Error(`${Commands.OpenChatFile}: Error calling parseActivitiesFromChatFile(): ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Sets the current user id (in memory)
  @Command(Commands.SetCurrentUser)
  protected async setCurrentUser(userId: string) {
    const { facilities } = Emulator.getInstance().framework.server.botEmulator;
    const { users } = facilities;
    const user = { id: userId, name: 'User' };
    users.currentUserId = userId;
    users.users[userId] = user;
    facilities.users = users;

    // update the settings state on both main and client
    dispatch(setCurrentUser(user));
    dispatch(pushClientAwareSettings());
  }

  // ---------------------------------------------------------------------------
  // Removes the conversation from the conversation set
  @Command(Commands.DeleteConversation)
  protected deleteConversation(conversationId: string) {
    return Emulator.getInstance().framework.server.botEmulator.facilities.conversations.deleteConversation(
      conversationId
    );
  }

  // ---------------------------------------------------------------------------
  // Removes the conversation from the conversation set
  @Command(Commands.PostActivityToConversation)
  protected postActivityToConversation(conversationId: string, activity: any, toUser: boolean) {
    const conversation = Emulator.getInstance().framework.server.botEmulator.facilities.conversations.conversationById(
      conversationId
    );
    if (toUser) {
      return conversation.postActivityToUser(activity, false);
    } else {
      return conversation.postActivityToBot(activity, false);
    }
  }

  @Command(Commands.StartEmulator)
  protected async startEmulator(forceRestart: boolean = false) {
    const emulator = Emulator.getInstance();
    const port = emulator.framework.serverPort || null;
    if (!forceRestart && emulator.framework.serverPort === port) {
      return;
    }
    await emulator.startup(port);
    const { users: userSettings, framework } = getSettingsStore().getState();
    const users = new Users();
    users.currentUserId = userSettings.currentUserId;
    users.users = userSettings.usersById;

    const { facilities } = emulator.framework.server.botEmulator;
    facilities.locale = framework.locale;
    facilities.users = users;
  }

  @Command(Commands.OpenProtocolUrls)
  protected async openProtocolUrls() {
    const {
      protocol: { openUrls },
    } = getStore().getState();
    if (openUrls.length) {
      await Promise.all(openUrls.map(url => ProtocolHandler.parseProtocolUrlAndDispatch(url)));
    }
    openUrls.length = 0;
  }
}
