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

// Remembers where the game window was and how big, so a relaunch opens it the same way
// instead of at Electron's default size. Stored in userData/window-state.json as
// `{ <key>: { x, y, width, height, maximized } }`; the single-account window and the
// multi-account shell share one key (it is the same window to the player). A saved position
// is only reused if it still lands on a connected display, so unplugging a monitor cannot
// open the window off screen.

import { app, BrowserWindow, screen } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { writeFileAtomicSync } from './atomicFile';

export interface SavedWindowState {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;
}

type Store = Record<string, SavedWindowState>;

/** Quiet time after the last resize/move before the state is written. */
const SAVE_DEBOUNCE_MS = 500;
/** At least this much of the window must be on some display for a saved position to be used. */
const MIN_VISIBLE_PX = 100;

function filePath() {
    return path.join(app.getPath('userData'), 'window-state.json');
}

function load(): Store {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('window-state.json unreadable, ignoring:', e);
        return {};
    }
}

function save(key: string, state: SavedWindowState) {
    try {
        const store = load();
        store[key] = state;
        writeFileAtomicSync(filePath(), JSON.stringify(store, null, 2));
    } catch (e) {
        log.warn('Could not save window state:', e);
    }
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** True when at least MIN_VISIBLE_PX × MIN_VISIBLE_PX of the rectangle is on a connected display. */
function onSomeDisplay(x: number, y: number, width: number, height: number): boolean {
    return screen.getAllDisplays().some(d => {
        const a = d.workArea;
        const w = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
        const h = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
        return w >= MIN_VISIBLE_PX && h >= MIN_VISIBLE_PX;
    });
}

/**
 * BrowserWindow constructor options for the saved state, or the given defaults when nothing
 * usable is saved. Must be called after app ready (it reads the displays). The size is also
 * clamped to the given minimums, matching the window's minWidth/minHeight.
 */
export function savedWindowOptions(
    key: string,
    defaults: { width: number; height: number; minWidth: number; minHeight: number }
): { x?: number; y?: number; width: number; height: number } {
    const s = load()[key];
    if (!s || !isFiniteNumber(s.width) || !isFiniteNumber(s.height)) {
        return { width: defaults.width, height: defaults.height };
    }
    const width = Math.max(defaults.minWidth, Math.round(s.width));
    const height = Math.max(defaults.minHeight, Math.round(s.height));
    if (isFiniteNumber(s.x) && isFiniteNumber(s.y) && onSomeDisplay(s.x, s.y, width, height)) {
        return { x: Math.round(s.x), y: Math.round(s.y), width, height };
    }
    return { width, height }; // size only; Electron centres it
}

/**
 * Keep the saved state in step with the window: maximise it now if it was maximised when last
 * closed, then record every resize, move and (un)maximise, and the final state on close.
 * The normal (restored) bounds are what is saved while maximised, so un-maximising later
 * comes back to the right size.
 */
export function trackWindowState(win: BrowserWindow, key: string) {
    if (load()[key]?.maximized === true) win.maximize();

    let timer: NodeJS.Timeout | null = null;
    const snapshot = (): SavedWindowState | null => {
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return null;
        const b = win.getNormalBounds();
        return { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    };
    const saveNow = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const s = snapshot();
        if (s) save(key, s);
    };
    const saveSoon = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    };

    win.on('resize', saveSoon);
    win.on('move', saveSoon);
    win.on('maximize', saveSoon);
    win.on('unmaximize', saveSoon);
    win.on('close', saveNow);
    win.once('closed', () => {
        if (timer) clearTimeout(timer);
        timer = null;
    });
}
