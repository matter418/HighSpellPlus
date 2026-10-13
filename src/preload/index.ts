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


import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { AccountState, PanelLayout, ShellState, UiLayoutStore } from '../shared/shellTypes';

const settingsAPI = {
    get: async (section: string, key: string) => ipcRenderer.invoke('settings:get', section, key),
    set: async (section: string, key: string, value: unknown) => ipcRenderer.invoke('settings:set', section, key, value),
    getAll: async () => ipcRenderer.invoke('settings:getAll'),
    getByName: async (label: string) => ipcRenderer.invoke('settings:getByName', label),
    selectDirectory: async (options?: { title?: string; defaultPath?: string }) =>
        ipcRenderer.invoke('settings:select-directory', options),
    validateDirectory: async (dirPath: string) => ipcRenderer.invoke('settings:validate-directory', dirPath),
};

const screenshotAPI = {
    capture: async () => ipcRenderer.invoke('screenshot:capture') as Promise<{ ok: boolean; path?: string; error?: string }>,
};

// Set on game views hosted by the multi-account shell (see main/windows/shell). The client
// page uses it to drop its own title bar, report state, and throttle rendering while hidden.
const slotArg = process.argv.find(a => a.startsWith('--hsplus-slot='));
const accountAPI = {
    embedded: Boolean(slotArg),
    slot: slotArg ? Number(slotArg.split('=')[1]) : 0,
    onVisibility: (cb: (visible: boolean) => void) => {
        ipcRenderer.on('account:visibility', (_event, visible: boolean) => cb(visible));
    },
    setState: (state: AccountState) => ipcRenderer.send('account:state', state),
    notifyWarning: (level: 'warning' | 'error') => ipcRenderer.send('account:warning', level),
    notifyAttention: (kind: string) => ipcRenderer.send('account:attention', kind),
    clearAttention: () => ipcRenderer.send('account:attention', null),
    /** Ask the shell to close this account (confirms if logged in). */
    requestClose: () => ipcRenderer.send('account:close'),
    /** How many accounts the window currently has (sent on every change). */
    onAccountCount: (cb: (count: number) => void) => {
        ipcRenderer.on('account:count', (_e, n: number) => cb(n));
    },
};

// Movable/resizable HUD panel layout (uiLayout.js); the store holds a shared layout plus one
// per character, and every change is broadcast to every window and view.
const uiLayoutAPI = {
    get: () => ipcRenderer.invoke('ui-layout:get') as Promise<UiLayoutStore>,
    /** scope: 'shared' or a character name. */
    set: (scope: string, layout: Record<string, PanelLayout>) => ipcRenderer.send('ui-layout:set', scope, layout),
    onChanged: (cb: (store: UiLayoutStore) => void) => {
        ipcRenderer.on('ui-layout:changed', (_e, store: UiLayoutStore) => cb(store));
    },
};

// Plugin-storage backups (main/modules/storageBackup): the loader calls offerRestore when it
// finds a freshly created database; main asks the user and relaunches on a restore.
const storageAPI = {
    offerRestore: () => ipcRenderer.invoke('storage:offer-restore') as Promise<{ offered: boolean; accepted?: boolean }>,
};

// Used only by shell.html.
const shellAPI = {
    getConfig: () => ipcRenderer.invoke('shell:get-config'),
    ready: () => ipcRenderer.send('shell:ready'),
    setContentBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
        ipcRenderer.send('shell:content-bounds', bounds),
    activate: (slot: number) => ipcRenderer.send('shell:activate', slot),
    add: () => ipcRenderer.send('shell:add'),
    close: (slot: number) => ipcRenderer.send('shell:close', slot),
    /** The user dismissed the warning indicator; views re-arm their console forwarding. */
    clearWarning: () => ipcRenderer.send('shell:clear-warning'),
    onState: (cb: (state: ShellState) => void) => {
        ipcRenderer.on('shell:state', (_e, s: ShellState) => cb(s));
    },
    onPreview: (cb: (p: { slot: number; dataUrl: string }) => void) => {
        ipcRenderer.on('shell:preview', (_e, p) => cb(p));
    },
    onWarning: (cb: (w: { slot: number; level: string }) => void) => {
        ipcRenderer.on('shell:warning', (_e, w) => cb(w));
    },
    onToggleCollapsed: (cb: () => void) => {
        ipcRenderer.on('shell:toggle-collapsed', () => cb());
    },
    onSettingsChanged: (cb: () => void) => {
        ipcRenderer.on('settings:changed', () => cb());
    },
};

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI);
        contextBridge.exposeInMainWorld('settings', settingsAPI);
        contextBridge.exposeInMainWorld('screenshot', screenshotAPI);
        contextBridge.exposeInMainWorld('account', accountAPI);
        contextBridge.exposeInMainWorld('shell', shellAPI);
        contextBridge.exposeInMainWorld('uiLayout', uiLayoutAPI);
        contextBridge.exposeInMainWorld('storage', storageAPI);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI;
    // @ts-ignore
    window.settings = settingsAPI;
    // @ts-ignore
    window.screenshot = screenshotAPI;
    // @ts-ignore
    window.account = accountAPI;
    // @ts-ignore
    window.shell = shellAPI;
    // @ts-ignore
    window.uiLayout = uiLayoutAPI;
    // @ts-ignore
    window.storage = storageAPI;
}
