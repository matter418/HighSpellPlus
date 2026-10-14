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
// Stored in userData/ui-layout.json as `{ shared, accounts: { <character name>: ... } }`. The
// "Shared Interface Layout" setting picks which scope a client edits; every change is broadcast
// to every window and every multi-account view so all clients follow at once.

import { app, ipcMain } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { allWebContents } from './windowRegistry';
import { writeFileAtomicSync } from './atomicFile';
import type { StoredPanelLayout, UiLayoutStore } from '../../shared/shellTypes';

type UiLayout = Record<string, StoredPanelLayout>;

// Panel keys are the `key:` values of the PANELS table in renderer/client/helpers/uiLayout.js;
// account names are character names taken from the window title.
const PANEL_KEY = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_NAME_LEN = 64;
// Same limits the drag handles enforce (MIN_SCALE/MAX_SCALE in uiLayout.js), so a hand-edited
// file cannot load a scale the UI could never produce or undo.
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

function filePath() {
    return path.join(app.getPath('userData'), 'ui-layout.json');
}

let store: UiLayoutStore | null = null;

function load(): UiLayoutStore {
    if (store) return store;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        store = sanitizeStore(raw);
    } catch (e) {
        // No file yet is normal; anything else means a corrupt file that the next drag will overwrite.
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('ui-layout.json unreadable, starting empty:', e);
        store = { shared: {}, accounts: {} };
    }
    return store;
}

function sanitizeStore(raw: any): UiLayoutStore {
    if (raw && typeof raw === 'object' && ('shared' in raw || 'accounts' in raw)) {
        const accounts: Record<string, UiLayout> = {};
        for (const [name, l] of Object.entries(raw.accounts || {})) {
            if (typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LEN) accounts[name] = sanitize(l);
        }
        return { shared: sanitize(raw.shared), accounts };
    }
    // Pre-2026-10-12 file: a flat panel map, which was the client-wide layout.
    return { shared: sanitize(raw), accounts: {} };
}

const X_ANCHORS = ['left', 'center', 'right'] as const;
const Y_ANCHORS = ['top', 'center', 'bottom'] as const;

function sanitize(raw: unknown): UiLayout {
    const out: UiLayout = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, v] of Object.entries(raw as Record<string, any>)) {
        if (!PANEL_KEY.test(key) || !v || typeof v !== 'object') continue;
        const rawScale = Number(v.scale);
        if (!Number.isFinite(rawScale)) continue;
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
        if ('ax' in v || 'ay' in v) {
            // Edge/centre-anchored entry (see PanelLayout in shellTypes.ts).
            const ox = Number(v.ox), oy = Number(v.oy);
            if (!X_ANCHORS.includes(v.ax) || !Y_ANCHORS.includes(v.ay) || ![ox, oy].every(Number.isFinite)) continue;
            out[key] = { ax: v.ax, ox, ay: v.ay, oy, scale };
        } else {
            // Legacy px-translate entry; the client migrates it once the panel is on screen.
            const dx = Number(v.dx), dy = Number(v.dy);
            if (![dx, dy].every(Number.isFinite)) continue;
            out[key] = { dx, dy, scale };
        }
    }
    return out;
}

function save(next: UiLayoutStore) {
    store = next;
    try {
        writeFileAtomicSync(filePath(), JSON.stringify(next, null, 2));
    } catch (e) {
        log.warn('Failed to save ui-layout.json:', e);
    }
}

/** Push the whole store to every page except `except` (the sender already has its own edit). */
function broadcast(except?: Electron.WebContents) {
    for (const wc of allWebContents()) {
        if (wc !== except) wc.send('ui-layout:changed', store);
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
            save({ ...current, accounts: { ...current.accounts, [scope.slice(0, MAX_NAME_LEN)]: clean } });
        }
        broadcast(event.sender);
    });
    // Settings window "Reset layout" button: shared AND every per-account layout, everywhere.
    ipcMain.on('ui-layout:reset', () => {
        save({ shared: {}, accounts: {} });
        broadcast();
    });
}
