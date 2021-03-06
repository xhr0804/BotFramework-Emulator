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

import { EventEmitter } from 'events';

import { ProgressInfo } from 'builder-util-runtime';
import { autoUpdater as electronUpdater, UpdateInfo } from 'electron-updater';
import { SharedConstants } from '@bfemulator/app-shared';
import { app } from 'electron';
import { newNotification } from '@bfemulator/app-shared';
import { CommandServiceImpl, CommandServiceInstance } from '@bfemulator/sdk-shared';

import { TelemetryService } from './telemetry';
import { getSettings } from './settingsData/store';
import { AppMenuBuilder } from './appMenuBuilder';
import { sendNotificationToClient } from './utils/sendNotificationToClient';

export enum UpdateStatus {
  Idle,
  UpdateAvailable,
  UpdateDownloading,
  UpdateReadyToInstall,
}

class EmulatorUpdater extends EventEmitter {
  @CommandServiceInstance()
  private commandService: CommandServiceImpl;

  private _userInitiated: boolean;
  private _autoDownload: boolean;
  private _status: UpdateStatus = UpdateStatus.Idle;
  private _allowPrerelease: boolean;
  private _updateDownloaded: boolean;
  private _downloadProgress: number;
  private _installAfterDownload: boolean;

  public get userInitiated(): boolean {
    return this._userInitiated;
  }

  public get status(): UpdateStatus {
    return this._status;
  }

  public get downloadProgress(): number {
    return this._downloadProgress;
  }

  public get updateDownloaded(): boolean {
    return this._updateDownloaded;
  }

  public get autoDownload(): boolean {
    return this._autoDownload;
  }

  public set autoDownload(value: boolean) {
    electronUpdater.autoDownload = value;
    this._autoDownload = value;
  }

  public get allowPrerelease(): boolean {
    return this._allowPrerelease;
  }

  public set allowPrerelease(value: boolean) {
    electronUpdater.allowPrerelease = value;
    this._allowPrerelease = value;
  }

  public get repo(): string {
    if (this.allowPrerelease) {
      return 'BotFramework-Emulator-Nightlies';
    }
    return 'BotFramework-Emulator';
  }

  public async startup() {
    const settings = getSettings().framework;
    this.allowPrerelease = !!settings.usePrereleases;
    this.autoDownload = !!settings.autoUpdate;

    electronUpdater.allowDowngrade = true; // allow pre-release -> stable release
    electronUpdater.autoInstallOnAppQuit = true;
    electronUpdater.logger = null;

    electronUpdater.on('update-available', this.onUpdateAvailable);
    electronUpdater.on('update-not-available', this.onUpdateNotAvailable);
    electronUpdater.on('error', this.onError);
    electronUpdater.on('download-progress', this.onDownloadProgress);
    electronUpdater.on('update-downloaded', this.onUpdateDownloaded);

    if (this.autoDownload) {
      await this.checkForUpdates(false);
    }
  }

  public async checkForUpdates(userInitiated: boolean): Promise<void> {
    const settings = getSettings().framework;
    this.allowPrerelease = !!settings.usePrereleases;
    this.autoDownload = !!settings.autoUpdate;
    this._userInitiated = userInitiated;

    electronUpdater.setFeedURL({
      repo: this.repo,
      owner: 'Microsoft',
      provider: 'github',
    });

    try {
      await electronUpdater.checkForUpdates();
      TelemetryService.trackEvent('update_check', {
        auto: !userInitiated,
        prerelease: this.allowPrerelease,
      });
    } catch (e) {
      throw new Error(`There was an error while checking for the latest update: ${e}`);
    }
  }

  public async downloadUpdate(installAfterDownload: boolean): Promise<void> {
    this._installAfterDownload = installAfterDownload;

    try {
      await electronUpdater.downloadUpdate();
    } catch (e) {
      throw new Error(`There was an error while trying to download the latest update: ${e}`);
    }
  }

  public quitAndInstall() {
    try {
      electronUpdater.quitAndInstall(false, true);
    } catch (e) {
      throw new Error(`There was an error while trying to quit and install the latest update: ${e}`);
    }
  }

  private onUpdateAvailable = async (updateInfo: UpdateInfo) => {
    if (!this.autoDownload) {
      this._status = UpdateStatus.Idle;
      try {
        AppMenuBuilder.refreshAppUpdateMenu();

        if (this.userInitiated) {
          const {
            ShowUpdateAvailableDialog,
            ShowProgressIndicator,
            UpdateProgressIndicator,
          } = SharedConstants.Commands.UI;
          const result = await this.commandService.remoteCall<{ installAfterDownload: boolean }>(
            ShowUpdateAvailableDialog,
            updateInfo.version
          );
          if (result) {
            // show but don't block on result of progress indicator dialog
            await this.commandService.remoteCall(UpdateProgressIndicator, {
              label: 'Downloading...',
              progress: 0,
            });
            this.commandService.remoteCall(ShowProgressIndicator);
            const { installAfterDownload = false } = result;
            await this.downloadUpdate(installAfterDownload);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`An error occurred in the updater's "update-available" event handler: ${e}`);
      }
    }
    // if this was initiated on startup, download in the background
    if (!this.userInitiated) {
      this.downloadUpdate(false).catch(e => this.emit('error', e, e.toString()));
    }
  };

  private onUpdateNotAvailable = async () => {
    this._status = UpdateStatus.Idle;
    try {
      // TODO - localization
      AppMenuBuilder.refreshAppUpdateMenu();

      // only show the alert if the user explicity checked for update, and no update was downloaded
      const { userInitiated, updateDownloaded } = this;
      if (userInitiated && !updateDownloaded) {
        const { ShowUpdateUnavailableDialog } = SharedConstants.Commands.UI;
        await this.commandService.remoteCall(ShowUpdateUnavailableDialog);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`An error occurred in the updater's "up-to-date" event handler: ${e}`);
    }
  };

  private onError = async (err: Error, message: string = '') => {
    this._status = UpdateStatus.Idle;
    // TODO - localization
    AppMenuBuilder.refreshAppUpdateMenu();
    // TODO - Send to debug.txt / error dump file
    if (message.includes('.yml')) {
      this.emit('up-to-date');
      return;
    }
    if (this.userInitiated) {
      await this.commandService.call(SharedConstants.Commands.Electron.ShowMessageBox, true, {
        title: app.getName(),
        message: `An error occurred while using the updater: ${err}`,
      });
    }
  };

  private onDownloadProgress = async (progress: ProgressInfo) => {
    this._status = UpdateStatus.UpdateDownloading;
    this._downloadProgress = progress.percent;
    try {
      AppMenuBuilder.refreshAppUpdateMenu();

      // update the progress bar component
      const { UpdateProgressIndicator } = SharedConstants.Commands.UI;
      const progressPayload = { label: 'Downloading...', progress: progress.percent };
      await this.commandService.remoteCall(UpdateProgressIndicator, progressPayload);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`An error occurred in the updater's "download-progress" event handler: ${e}`);
    }
  };

  private onUpdateDownloaded = async (updateInfo: UpdateInfo) => {
    TelemetryService.trackEvent('update_download', {
      version: updateInfo.version,
      installAfterDownload: this._installAfterDownload,
    });
    if (this._installAfterDownload) {
      this.quitAndInstall();
      return;
    } else {
      this._status = UpdateStatus.UpdateReadyToInstall;
      this._updateDownloaded = true;
      try {
        AppMenuBuilder.refreshAppUpdateMenu();

        // TODO - localization
        if (this.userInitiated) {
          // update the progress indicator
          const { UpdateProgressIndicator } = SharedConstants.Commands.UI;
          const progressPayload = { label: 'Download finished.', progress: 100 };
          await this.commandService.remoteCall(UpdateProgressIndicator, progressPayload);

          // send a notification when the update is finished downloading
          const notification = newNotification(
            `Emulator version ${updateInfo.version} has finished downloading. Restart and update now?`
          );
          notification.addButton('Dismiss', () => {
            const { Commands } = SharedConstants;
            this.commandService.remoteCall(Commands.Notifications.Remove, notification.id);
          });
          notification.addButton('Restart', async () => {
            try {
              this.quitAndInstall();
            } catch (e) {
              await sendNotificationToClient(newNotification(e), this.commandService);
            }
          });
          await sendNotificationToClient(notification, this.commandService);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`An error occurred in the updater's "update-downloaded" event handler: ${e}`);
      }
    }
  };
}

export const AppUpdater = new EmulatorUpdater();
