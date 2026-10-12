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

import { BrowserWindow, WebContents } from 'electron';

// IPC handlers historically resolved their window with BrowserWindow.fromWebContents(sender).
// That returns null for a WebContentsView (the multi-account game views), so every view and
// every shell page registers here and handlers resolve through this module instead.

type ActiveGameResolver = () => WebContents | null;

const owners = new Map<number, { win: BrowserWindow; activeGame: ActiveGameResolver }>();

/** Register a WebContents (view or shell page) as belonging to `win`. */
export function registerWebContents(wc: WebContents, win: BrowserWindow, activeGame: ActiveGameResolver) {
    owners.set(wc.id, { win, activeGame });
    wc.once('destroyed', () => owners.delete(wc.id));
}

/** The BrowserWindow a sender lives in, whether it is the window's own page or a child view. */
export function resolveWindow(sender: WebContents): BrowserWindow | null {
    const direct = BrowserWindow.fromWebContents(sender);
    if (direct) return direct;
    const owner = owners.get(sender.id);
    return owner && !owner.win.isDestroyed() ? owner.win : null;
}

/**
 * The WebContents that is showing the game for a sender: the active account view in a
 * multi-account window, or the sender itself in a single-account window.
 */
export function resolveGameWebContents(sender: WebContents): WebContents | null {
    const owner = owners.get(sender.id);
    if (owner) return owner.activeGame();
    return sender;
}
