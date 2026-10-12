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

// Hidden-account frame throttle (ported from the mobile client's frame-throttle.ts).
//
// Inactive accounts in the multi-account shell are WebContentsViews with setVisible(false).
// Chromium stops producing compositor frames for a hidden view, so anything that re-arms
// itself from inside requestAnimationFrame (the game loop, Babylon) would simply stop, the
// socket would stop ponging and the server would drop the session a minute later. While
// hidden, every rAF caller is served from a slow setTimeout pump instead (15 fps by default,
// 2–60 via the "Background Frame Rate" setting). JS, timers and the game socket stay fully
// alive; the game loop's accumulator TIMESTEP is 600 ms so even 2 fps loses nothing, and
// there is far less render churn for views nobody is looking at.
//
// The wrapper owns the id space and migrates pending callbacks between the real queue and
// the pump on every state change so nothing is stranded in a queue that stopped ticking.

const nativeRaf = window.requestAnimationFrame.bind(window);
const nativeCaf = window.cancelAnimationFrame.bind(window);

// Frame interval while hidden; configurable via the "Background Frame Rate" setting. The 15
// here and in setHiddenFrameRate must match that setting's default in src/preload/settings.ts.
let hiddenFrameMs = 1000 / 15;

let hidden = false;
let nextId = 1;
/** @type {Map<number, {kind: 'raf'|'timeout', underlying: number, cb: FrameRequestCallback}>} */
const pending = new Map();

function schedule(id, cb) {
    if (hidden) {
        return {
            kind: 'timeout',
            cb,
            underlying: window.setTimeout(() => {
                pending.delete(id);
                cb(performance.now());
            }, hiddenFrameMs),
        };
    }
    return {
        kind: 'raf',
        cb,
        underlying: nativeRaf(ts => {
            pending.delete(id);
            cb(ts);
        }),
    };
}

function unschedule(p) {
    if (p.kind === 'timeout') window.clearTimeout(p.underlying);
    else nativeCaf(p.underlying);
}

/** Frames per second to serve while hidden (2–60). Takes effect from the next frame. */
export function setHiddenFrameRate(fps) {
    const clamped = Math.min(60, Math.max(2, Number(fps) || 15));
    hiddenFrameMs = Math.round(1000 / clamped);
}

export function setHidden(h) {
    if (h === hidden) return;
    hidden = h;
    for (const [id, p] of [...pending]) {
        unschedule(p);
        pending.set(id, schedule(id, p.cb));
    }
}

/** Must run before the game bundle is injected so its rAF calls go through the wrapper. */
export function initFrameThrottle() {
    window.requestAnimationFrame = cb => {
        const id = nextId++;
        pending.set(id, schedule(id, cb));
        return id;
    };
    window.cancelAnimationFrame = id => {
        const p = pending.get(id);
        if (p) {
            unschedule(p);
            pending.delete(id);
        }
    };
}
