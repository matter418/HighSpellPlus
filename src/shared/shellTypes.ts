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

/**
 * One movable HUD panel, as stored by uiLayoutStore. The panel's visible box is pinned per
 * axis to the nearest viewport edge or the centre, with a px gap: `ax: 'left'` → box.left =
 * viewport.left + ox; `'right'` → box.right = viewport.right − ox; `'center'` → box centre =
 * viewport centre + ox (same for y with top/bottom). The gap is measured on the scaled box, so
 * the layout survives window resizes and fits multibox tiles of any size.
 */
export interface PanelLayout {
    ax: 'left' | 'center' | 'right';
    ox: number;
    ay: 'top' | 'center' | 'bottom';
    oy: number;
    scale: number;
}

/**
 * Pre-2026-10-14 entry: a px translate from wherever the game itself places the panel. Kept
 * readable so existing files load; the client converts one to a PanelLayout the first time the
 * panel is on screen (it needs the panel's size and the viewport to do so) and saves it back.
 */
export interface LegacyPanelLayout {
    dx: number;
    dy: number;
    scale: number;
}

export type StoredPanelLayout = PanelLayout | LegacyPanelLayout;

/** Everything in userData/ui-layout.json: the shared layout plus one per character name. */
export interface UiLayoutStore {
    shared: Record<string, StoredPanelLayout>;
    accounts: Record<string, Record<string, StoredPanelLayout>>;
}
