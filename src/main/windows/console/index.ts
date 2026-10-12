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
import path from 'path';

// The console window used to be created (hidden) at startup, which costs a whole renderer
// process for the lifetime of the app and makes every console.* call from the game do IPC +
// DOM work in a window nobody is looking at. It is now created on first "show-console", and
// messages logged before that are kept in a small ring buffer so the window is populated on open.
const BUFFER_LIMIT = 300;
const buffer: any[] = [];
let consoleWindow: BrowserWindow | null = null;

function buildConsoleWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            sandbox: false, // Disable sandboxing for compatibility with some libraries
            webSecurity: app.isPackaged, // Disable web security only in development for CORS
        },
        icon: path.join(__dirname, 'icons/icon.png'),
        titleBarStyle: 'hidden',
        show: false, // shown once the renderer is ready
    });

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/console.html`);
    } else {
        win.loadFile(path.join(__dirname, '../renderer/console.html'));
    }

    win.setMenu(null);
    win.webContents.once('did-finish-load', () => {
        for (const msg of buffer) win.webContents.send('add-console-message', msg);
        buffer.length = 0;
        win.show();
    });
    win.on('closed', () => {
        consoleWindow = null;
    });
    return win;
}

export function getConsoleWindow(): BrowserWindow | null {
    return consoleWindow;
}

/** Registers the console IPC handlers. Does NOT create a window. */
export function registerConsoleIPC() {
    ipcMain.on('show-console', () => {
        if (!consoleWindow || consoleWindow.isDestroyed()) {
            consoleWindow = buildConsoleWindow();
            return;
        }
        if (consoleWindow.isMinimized()) {
            consoleWindow.restore();
        }
        consoleWindow.show();
    });

    ipcMain.on('add-console-message', (data) => {
        if (consoleWindow && !consoleWindow.isDestroyed()) {
            consoleWindow.webContents.send('add-console-message', data);
        } else {
            buffer.push(data);
            if (buffer.length > BUFFER_LIMIT) buffer.shift();
        }
    });
}
