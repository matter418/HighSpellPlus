// Copyright (C) 2025  HighLite

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { app, BrowserWindow, ipcMain } from 'electron';
import { electronApp } from '@electron-toolkit/utils';
import { createUpdateWindow } from './windows/updater';
import { registerConsoleIPC, getConsoleWindow } from './windows/console';
import { createClientWindow } from './windows/client';
import log from 'electron-log';
import registerScreenshotIPC from './modules/screenshotManagement/index';
import fs from 'fs';
import path from 'path';

// One-time migration: the app was renamed from RyeLite to Highspell+, which moves the
// userData folder (settings, saved logins, installed plugins, IndexedDB). If the new
// folder doesn't exist yet but the old one does, copy it across so nothing is lost.
// Must run before anything touches userData (i.e. before app.whenReady()).
(function migrateUserDataFromRyeLite() {
    try {
        const newDir = app.getPath('userData');
        const oldDir = path.join(path.dirname(newDir), 'RyeLite');
        if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
            fs.cpSync(oldDir, newDir, { recursive: true });
            log.info(`Migrated user data from ${oldDir} to ${newDir}`);
        }
    } catch (e) {
        log.warn('User data migration from RyeLite failed:', e);
    }
})();

log.initialize({ spyRendererConsole: true });
log.transports.console.level = 'info';
log.transports.file.level = 'debug';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.highspellplus.desktop');
    const updateWindow: BrowserWindow = await createUpdateWindow();

    // Console window is created lazily on first "show-console" (see windows/console).
    registerConsoleIPC();

    registerScreenshotIPC();
    ipcMain.once('delay-update', async () => {
        await createClientWindow();
        updateWindow.close();
    });

    ipcMain.on('no-update-available', async () => {
        await createClientWindow();
        updateWindow.close();
    });

    // For any future windows created elsewhere, attach a closed handler
    // to determine when only the console window is left.
    app.on('browser-window-created', (_event, win) => {
        if (win !== getConsoleWindow()) {
            win.on('closed', () => {
                const consoleWin = getConsoleWindow();
                const others = BrowserWindow.getAllWindows().filter(w => w !== consoleWin);
                if (others.length === 0 && consoleWin && !consoleWin.isDestroyed()) {
                    consoleWin.close();
                }
            });
        }
    });

    app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createClientWindow();
        }
    });
});

app.on('second-instance', (_event, _argv, _workingDirectory) => {
    // Someone tried to run a second instance, open a new window in response.
    createClientWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
