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

import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { format } from 'url';

import './modules/userPasswordManagement'; // Import user password management module
import './modules/windowEventManagement'; // Import window event management module
import { createShellWindow, isMultiAccountEnabled } from '../shell';
import { wireGameWebContents } from '../../modules/gameWebContents';

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Reroute any calls to the old website (highlite.dev) to the new one (ryelite.org).
//  For use with legacy plugins.
app.on("ready", () => {
    const filter = { urls: ["*://highlite.dev/*"] };
  
    session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
      const newUrl = details.url.replace("highlite.dev", "ryelite.org");
      callback({ redirectURL: newUrl });
    });
  });

export async function createClientWindow() {
    // Multi-account mode swaps the single page-per-window layout for a shell window that
    // hosts one WebContentsView per account. Everything below is the unchanged single-account path.
    if (isMultiAccountEnabled()) {
        return createShellWindow();
    }

    const mainWindow = new BrowserWindow({
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            sandbox: false, // Disable sandboxing for compatibility with some libraries
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,

            webSecurity: app.isPackaged, // Disable web security only in development for CORS
        },
        minHeight: 500,
        minWidth: 500,
        icon: path.join(__dirname, 'icons/icon.png'),
        titleBarStyle: 'hidden',
        show: true,
    });

    mainWindow.setMenu(null);
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        const devUrl = `${process.env['ELECTRON_RENDERER_URL']}/client.html`;
        console.log('Loading dev URL:', devUrl);
        mainWindow.loadURL(devUrl);
    } else {
        const fileUrl = format({
            protocol: 'file',
            slashes: true,
            pathname: path.join(__dirname, '../renderer/client.html'),
            query: { windowId: mainWindow.id },
        });

        mainWindow.loadURL(fileUrl);
    }

    // External links, F12, Ctrl+wheel zoom, console forwarding, dev user agent.
    wireGameWebContents(mainWindow.webContents);

    // In development, modify requests to High Spell servers
    if (!app.isPackaged) {
        mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
            (details, callback) => {
                if (details.url.includes('highspell.com')) {
                    details.requestHeaders['Origin'] = 'https://highspell.com';
                    details.requestHeaders['Referer'] =
                        'https://highspell.com/';
                }
                callback({ requestHeaders: details.requestHeaders });
            }
        );
    }

    mainWindow.on('ready-to-show', () => {
        // Always start with zoom reset to 0.0
        mainWindow.webContents.setZoomLevel(0);
    });

    

    return mainWindow;
}
