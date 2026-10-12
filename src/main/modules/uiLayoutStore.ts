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

// Per-client HUD layout store (positions/scales of the movable game panels).
//
// One layout for the whole client, not per account: it lives in userData, and every change is
// broadcast to every window and every multi-account view so all accounts follow at once.

import { app, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';

export interface PanelLayout {
    /** Offset from the panel's natural position, CSS px. */
    dx: number;
    dy: number;
    /** Visual scale, 1 = game default. */
    scale: number;
}

export type UiLayout = Record<string, PanelLayout>;

const filePath = () => path.join(app.getPath('userData'), 'ui-layout.json');

let layout: UiLayout | null = null;

function load(): UiLayout {
    if (layout) return layout;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        layout = sanitize(raw);
    } catch {
        layout = {};
    }
    return layout;
}

function sanitize(raw: unknown): UiLayout {
    const out: UiLayout = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, v] of Object.entries(raw as Record<string, any>)) {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(key) || !v || typeof v !== 'object') continue;
        const dx = Number(v.dx), dy = Number(v.dy), scale = Number(v.scale);
        if (![dx, dy, scale].every(Number.isFinite)) continue;
        out[key] = { dx, dy, scale: Math.min(4, Math.max(0.25, scale)) };
    }
    return out;
}

function save(next: UiLayout) {
    layout = next;
    try {
        fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8');
    } catch (e) {
        log.warn('Failed to save ui-layout.json:', e);
    }
}

function broadcast(except?: Electron.WebContents) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        const targets: Electron.WebContents[] = [win.webContents];
        for (const view of win.contentView.children) {
            const wc = (view as any).webContents as Electron.WebContents | undefined;
            if (wc) targets.push(wc);
        }
        for (const wc of targets) {
            if (!wc.isDestroyed() && wc !== except) wc.send('ui-layout:changed', layout);
        }
    }
}

export function registerUiLayoutIPC() {
    ipcMain.handle('ui-layout:get', () => load());
    ipcMain.on('ui-layout:set', (event, next: unknown) => {
        save(sanitize(next));
        broadcast(event.sender);
    });
    // Settings window "Reset layout" button: everything back to the game's defaults, everywhere.
    ipcMain.on('ui-layout:reset', () => {
        save({});
        broadcast();
    });
    // Diagnostics from uiLayout.js: appended to userData/ui-layout-debug.jsonl so the real HUD
    // structure can be inspected without a debugger (renderer console logs are not reliably
    // mirrored into main.log).
    ipcMain.on('ui-layout:debug', (_event, entry: unknown) => {
        try {
            const line = JSON.stringify({ at: new Date().toISOString(), ...(entry as object) }) + '\n';
            fs.appendFileSync(path.join(app.getPath('userData'), 'ui-layout-debug.jsonl'), line, 'utf8');
        } catch (e) {
            log.warn('ui-layout debug write failed:', e);
        }
    });
}
