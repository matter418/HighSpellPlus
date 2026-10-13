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

import { app, BrowserWindow, ipcMain, session } from 'electron';
import { electronApp } from '@electron-toolkit/utils';
import { createUpdateWindow } from './windows/updater';
import { registerConsoleIPC, getConsoleWindow } from './windows/console';
import { createClientWindow } from './windows/client';
import { addAccountToShell } from './windows/shell';
import log from 'electron-log';
import registerScreenshotIPC from './modules/screenshotManagement/index';
import { registerUiLayoutIPC } from './modules/uiLayoutStore';
import { registerVendorScheme, registerVendorProtocol } from './modules/vendorProtocol';
import { restoreIfRequested, snapshotIndexedDB, registerStorageBackupIPC } from './modules/storageBackup';
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

// The vendored plugin framework is served over hsplus:// (modules/vendorProtocol); the
// scheme must be declared before the app is ready.
registerVendorScheme();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    // Plugin-storage safety net (modules/storageBackup): apply a restore the previous run
    // asked for, then snapshot the storage - both before any window can open the profile.
    restoreIfRequested();
    snapshotIndexedDB();
}

app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.highspellplus.desktop');
    registerVendorProtocol(session.defaultSession);
    const updateWindow: BrowserWindow = await createUpdateWindow();

    // Console window is created lazily on first "show-console" (see windows/console).
    registerConsoleIPC();

    registerScreenshotIPC();
    registerUiLayoutIPC();
    registerStorageBackupIPC();
    ipcMain.once('delay-update', async () => {
        await createClientWindow();
        updateWindow.close();
    });

    // once: the updater can emit this more than once in a run (an error after
    // update-not-available, say) and a second call would open a second client window.
    ipcMain.once('no-update-available', async () => {
        await createClientWindow();
        updateWindow.close();
    });

    // Close the console window when it is the only window left. The console is excluded
    // inside the handler rather than here: this event fires during `new BrowserWindow`,
    // before the console module has stored its reference, so the outer check would never match.
    app.on('browser-window-created', (_event, win) => {
        win.on('closed', () => {
            const consoleWin = getConsoleWindow();
            if (win === consoleWin) return;
            const others = BrowserWindow.getAllWindows().filter(w => w !== consoleWin);
            if (others.length === 0 && consoleWin && !consoleWin.isDestroyed()) {
                consoleWin.close();
            }
        });
    });

    app.on('activate', () => {
        // macOS: clicking the dock icon with no windows open re-creates one (with multi-account
        // on, createClientWindow opens the shell with a first account).
        if (BrowserWindow.getAllWindows().length === 0) {
            createClientWindow();
        }
    });
});

app.on('second-instance', (_event, _argv, _workingDirectory) => {
    // Someone tried to run a second instance. With multi-account on, that means another
    // account tab in the existing window; otherwise open a second window as before.
    if (!addAccountToShell()) {
        createClientWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
