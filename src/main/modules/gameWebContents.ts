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

// Behaviour every WebContents that shows the game needs, whether it is the single-account
// window's own page or one account view inside the multi-account shell: open links in the
// system browser, F12 for dev tools, Ctrl+wheel zoom, console forwarding to our console window,
// and (in development) a browser user agent the game servers accept.

import { app, ipcMain, shell, WebContents } from 'electron';

/** Shape of every 'add-console-message' payload (see windows/console). */
export interface ConsoleMessage {
    /** Chromium's level name ('info', 'warning', 'error', 'debug'). */
    level: string;
    text: string;
    lineNumber: number;
    source: string;
    /** Multi-account slot the message came from; absent for the single-account window. */
    slot?: number;
}

const DEV_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ZOOM_STEP = 0.1;

export interface GameWebContentsOptions {
    /** Multi-account slot, attached to forwarded console messages. */
    slot?: number;
    /** Runs for every keyDown that was not F12 (the shell uses it for Ctrl+1…6 etc.). */
    onKeyDown?: (event: Electron.Event, input: Electron.Input) => void;
}

export function wireGameWebContents(wc: WebContents, opts: GameWebContentsOptions = {}) {
    if (!app.isPackaged) wc.setUserAgent(DEV_USER_AGENT);

    wc.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    wc.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F12') {
            event.preventDefault();
            wc.toggleDevTools();
            return;
        }
        opts.onKeyDown?.(event, input);
    });

    wc.on('zoom-changed', (_event, zoomDirection) => {
        const delta = zoomDirection === 'in' ? ZOOM_STEP : -ZOOM_STEP;
        wc.setZoomLevel(wc.getZoomLevel() + delta);
    });

    wc.on('console-message', (event) => {
        const msg: ConsoleMessage = {
            level: event.level,
            text: event.message,
            lineNumber: event.lineNumber,
            source: event.sourceId,
            slot: opts.slot,
        };
        // In-process event bus (ipcMain.emit, not a renderer channel); windows/console listens.
        ipcMain.emit('add-console-message', msg);
    });
}
