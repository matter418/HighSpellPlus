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

// Types shared by the multi-account shell's three sides: the main process (which owns the
// accounts), the preload bridge (which types window.shell) and the shell page itself.
// Types only: this file must stay free of runtime imports so every side can use it.

export type ShellLayout = 'top' | 'bottom' | 'left' | 'right' | 'multibox';

export type AccountState = 'loading' | 'login' | 'ingame' | 'crashed';

/** One account as the shell page sees it. */
export interface ShellAccountInfo {
    slot: number;
    /** Character name once known (from the window title), '' before login. */
    name: string;
    state: AccountState;
    active: boolean;
    /** Set while a background account wants attention (e.g. 'idle'); null otherwise. */
    attention: string | null;
}

/** Sent to the shell page on every change (`shell:state`). */
export interface ShellState {
    activeSlot: number;
    max: number;
    accounts: ShellAccountInfo[];
}

/** The MultiAccount settings as read by the main process (`shell:get-config`). */
export interface ShellConfig {
    layout: ShellLayout;
    previews: boolean;
    startCollapsed: boolean;
    /** Hidden-view render rate and dock thumbnail refresh rate, frames per second. */
    fps: number;
    isolateSessions: boolean;
    /** #rrggbb used for the idle flash on tabs and dock cards. */
    attentionColor: string;
    /** Account limit; same as ShellState.max. */
    max: number;
}

/** One movable HUD panel's offset (px) and scale, as stored by uiLayoutStore. */
export interface PanelLayout {
    dx: number;
    dy: number;
    scale: number;
}

/** Everything in userData/ui-layout.json: the shared layout plus one per character name. */
export interface UiLayoutStore {
    shared: Record<string, PanelLayout>;
    accounts: Record<string, Record<string, PanelLayout>>;
}
