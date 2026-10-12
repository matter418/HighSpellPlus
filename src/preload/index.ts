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

const settingsAPI = {
    get: async (section, key) => ipcRenderer.invoke('settings:get', section, key),
    set: async (section, key, value) => ipcRenderer.invoke('settings:set', section, key, value),
    getAll: async () => ipcRenderer.invoke('settings:getAll'),
    getByName: async (label) => ipcRenderer.invoke('settings:getByName', label),
    selectDirectory: async (options) => ipcRenderer.invoke('settings:select-directory', options),
    validateDirectory: async (dirPath) => ipcRenderer.invoke('settings:validate-directory', dirPath),
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
    setState: (state: 'loading' | 'login' | 'ingame' | 'crashed') => ipcRenderer.send('account:state', state),
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

// Per-client HUD layout (movable/resizable game panels); shared by every window and view.
const uiLayoutAPI = {
    get: () => ipcRenderer.invoke('ui-layout:get'),
    set: (layout: Record<string, { dx: number; dy: number; scale: number }>) => ipcRenderer.send('ui-layout:set', layout),
    onChanged: (cb: (layout: Record<string, { dx: number; dy: number; scale: number }>) => void) => {
        ipcRenderer.on('ui-layout:changed', (_e, l) => cb(l));
    },
    debug: (entry: unknown) => ipcRenderer.send('ui-layout:debug', entry),
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
    onState: (cb: (state: any) => void) => { ipcRenderer.on('shell:state', (_e, s) => cb(s)); },
    onPreview: (cb: (p: { slot: number; dataUrl: string }) => void) => { ipcRenderer.on('shell:preview', (_e, p) => cb(p)); },
    onWarning: (cb: (w: { slot: number; level: string }) => void) => { ipcRenderer.on('shell:warning', (_e, w) => cb(w)); },
    onToggleCollapsed: (cb: () => void) => { ipcRenderer.on('shell:toggle-collapsed', () => cb()); },
    onSettingsChanged: (cb: () => void) => { ipcRenderer.on('settings:changed', () => cb()); },
};

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI);
        contextBridge.exposeInMainWorld('settings', settingsAPI);
        contextBridge.exposeInMainWorld('screenshot', screenshotAPI);
        contextBridge.exposeInMainWorld('account', accountAPI);
        contextBridge.exposeInMainWorld('shell', shellAPI);
        contextBridge.exposeInMainWorld('uiLayout', uiLayoutAPI);
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
}
