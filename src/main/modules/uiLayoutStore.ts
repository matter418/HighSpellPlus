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

/** `shared` is used when "Shared Interface Layout" is on; otherwise `accounts[<character name>]`. */
export interface UiLayoutStore {
    shared: UiLayout;
    accounts: Record<string, UiLayout>;
}

const filePath = () => path.join(app.getPath('userData'), 'ui-layout.json');

let store: UiLayoutStore | null = null;

function load(): UiLayoutStore {
    if (store) return store;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        store = sanitizeStore(raw);
    } catch {
        store = { shared: {}, accounts: {} };
    }
    return store;
}

function sanitizeStore(raw: any): UiLayoutStore {
    if (raw && typeof raw === 'object' && ('shared' in raw || 'accounts' in raw)) {
        const accounts: Record<string, UiLayout> = {};
        for (const [name, l] of Object.entries(raw.accounts || {})) {
            if (typeof name === 'string' && name.length > 0 && name.length <= 64) accounts[name] = sanitize(l);
        }
        return { shared: sanitize(raw.shared), accounts };
    }
    // Pre-2026-10-12 file: a flat panel map, which was the client-wide layout.
    return { shared: sanitize(raw), accounts: {} };
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

function save(next: UiLayoutStore) {
    store = next;
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
            if (!wc.isDestroyed() && wc !== except) wc.send('ui-layout:changed', store);
        }
    }
}

export function registerUiLayoutIPC() {
    ipcMain.handle('ui-layout:get', () => load());
    // scope: 'shared' or a character name; `next` is that scope's panel map.
    ipcMain.on('ui-layout:set', (event, scope: unknown, next: unknown) => {
        const current = load();
        const clean = sanitize(next);
        if (scope === 'shared' || typeof scope !== 'string' || !scope) {
            save({ ...current, shared: clean });
        } else {
            save({ ...current, accounts: { ...current.accounts, [scope.slice(0, 64)]: clean } });
        }
        broadcast(event.sender);
    });
    // Settings window "Reset layout" button: shared AND every per-account layout, everywhere.
    ipcMain.on('ui-layout:reset', () => {
        save({ shared: {}, accounts: {} });
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
