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

import { ElectronAPI } from '@electron-toolkit/preload';

type AccountState = 'loading' | 'login' | 'ingame' | 'crashed';

interface ShellAccountInfo {
    slot: number;
    name: string;
    state: AccountState;
    active: boolean;
    /** Set while a background account wants attention (e.g. 'idle'); null otherwise. */
    attention: string | null;
}

interface ShellState {
    activeSlot: number;
    max: number;
    accounts: ShellAccountInfo[];
}

interface ShellConfig {
    layout: 'top' | 'bottom' | 'left' | 'right' | 'multibox';
    previews: boolean;
    startCollapsed: boolean;
    attentionColor: string;
    max: number;
}

declare global {
    interface Window {
        electron: ElectronAPI;
        settings: {
            get: (section: string, key: string) => Promise<any>;
            set: (section: string, key: string, value: any) => Promise<void>;
            getAll: () => Promise<Record<string, any>>;
            getByName: (label: string) => Promise<any>;
            selectDirectory: (options?: { title?: string; defaultPath?: string }) => Promise<string | null>;
            validateDirectory: (dirPath: string) => Promise<boolean>;
        };
        screenshot: {
            capture: () => Promise<{ ok: boolean; path?: string; error?: string }>;
        };
        /** Present on every page; `embedded` is true only inside a multi-account shell view. */
        account: {
            embedded: boolean;
            slot: number;
            onVisibility: (cb: (visible: boolean) => void) => void;
            setState: (state: AccountState) => void;
            notifyWarning: (level: 'warning' | 'error') => void;
            /** Ask the shell to flash this account's tab (e.g. 'idle'). */
            notifyAttention: (kind: string) => void;
            clearAttention: () => void;
            requestClose: () => void;
            onAccountCount: (cb: (count: number) => void) => void;
        };
        /** Per-client HUD layout for the movable game panels (uiLayout.js). */
        uiLayout: {
            get: () => Promise<{ shared: Record<string, { dx: number; dy: number; scale: number }>; accounts: Record<string, Record<string, { dx: number; dy: number; scale: number }>> }>;
            set: (scope: string, layout: Record<string, { dx: number; dy: number; scale: number }>) => void;
            onChanged: (cb: (store: { shared: Record<string, { dx: number; dy: number; scale: number }>; accounts: Record<string, Record<string, { dx: number; dy: number; scale: number }>> }) => void) => void;
            /** Append a diagnostics record to userData/ui-layout-debug.jsonl. */
            debug: (entry: unknown) => void;
        };
        /** Debug hook installed by idleWatch.js in shell-hosted views. */
        __hsplusIdleWatch?: () => unknown;
        /** Only meaningful in shell.html. */
        shell: {
            getConfig: () => Promise<ShellConfig>;
            ready: () => void;
            setContentBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
            activate: (slot: number) => void;
            add: () => void;
            close: (slot: number) => void;
            onState: (cb: (state: ShellState) => void) => void;
            onPreview: (cb: (p: { slot: number; dataUrl: string }) => void) => void;
            onWarning: (cb: (w: { slot: number; level: string }) => void) => void;
            onToggleCollapsed: (cb: () => void) => void;
            onSettingsChanged: (cb: () => void) => void;
        };
    }
}
