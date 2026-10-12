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

import { ipcMain } from 'electron';
import { resolveWindow } from '../../../../modules/windowRegistry';

// Window Controls Handling.
// resolveWindow() (not BrowserWindow.fromWebContents) so these also work when the sender is a
// multi-account game view rather than a window's own page.
ipcMain.on('minimize-window', event => {
    const window = resolveWindow(event.sender);
    if (window && window.isMinimizable()) {
        window.minimize();
    }
});

ipcMain.on('toggle-maximize-window', event => {
    const window = resolveWindow(event.sender);
    if (window) {
        if (window.isMaximized()) {
            window.unmaximize();
        } else {
            window.maximize();
        }
    }
});

ipcMain.on('close-window', event => {
    const window = resolveWindow(event.sender);
    if (window && !window.isDestroyed()) {
        if (window.getTitle() === "Console") {
            window.hide();
            return;
        }
        window.close();
    }
});

// UI Ready Handling
ipcMain.on('ui-ready', event => {
    const window = resolveWindow(event.sender);
    if (window) {
        window.show();
    }
});

// Dev Tools Handling: toggle the sender's own dev tools (a game view has its own).
ipcMain.on('show-dev-tools', event => {
    if (!event.sender.isDestroyed()) {
        event.sender.toggleDevTools();
    }
});
