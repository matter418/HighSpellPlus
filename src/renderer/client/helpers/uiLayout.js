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

// Movable / resizable HUD (RuneLite-style). Hold the modifier key (Alt by default) and:
//   - drag a panel to move it,
//   - drag one of the four corner squares to scale it,
//   - double-click a panel to reset it.
// Panels are the game's own absolutely positioned HUD containers and pop-up windows (bank,
// crafting stations, shop, trade, loot); we only ever add a CSS transform, so the game keeps
// laying them out as usual and hit-testing follows the transform. The main process stores one shared layout plus one per character; the
// "Shared Interface Layout" setting picks which one this client edits (see scope()), and every
// change is pushed live to the other windows and multi-account views.

import { accountNameFromTitle } from './titlebarHelpers.js';

const PANELS = [
    // key, selector, anchor corner (the corner that stays put while scaling: where the game pins
    // it), and optional followers: separate game elements that ride along with the panel.
    {
        key: 'minimap', selector: '#hs-minimap-container', anchor: 'top right',
        followers: ['#hs-toggle-minimap-button'],
    },
    { key: 'compass',   selector: '#hs-compass-button',                  anchor: 'top right'    },
    { key: 'logout',    selector: '#hs-logout-button',                   anchor: 'top right'    },
    { key: 'actionbar', selector: '#hs-action-bar-menu',                 anchor: 'top right'    },
    { key: 'sidebar',   selector: '#hs-side-action-bar-menu',            anchor: 'top right'    },
    { key: 'chat',      selector: '#hs-chat-menu-section-container',     anchor: 'bottom left'  },
    // The inventory/skills window and its tab bar share a container; they move separately.
    { key: 'inventory', selector: '#hs-game-menu-container',             anchor: 'bottom right' },
    { key: 'menubar',   selector: '#hs-game-menu-bar-section-container .hs-game-menu-bar', anchor: 'bottom right' },
    // Pop-up windows. The game appends these to the screen mask when opened and removes them
    // on close, and centres them itself (see centring()); they scale about their centre. One
    // layout per window: the five crafting stations (crafting table, potion making, smithing,
    // smelting, kiln) share the create-items window and only the header title differs.
    { key: 'bank',   selector: '#hs-bank-menu',         anchor: 'center', window: true },
    { key: 'create', selector: '.hs-create-items-menu', anchor: 'center', window: true },
    { key: 'shop',   selector: '#hs-shop-menu',         anchor: 'center', window: true },
    { key: 'trade',  selector: '#hs-trade-menu',        anchor: 'center', window: true },
    { key: 'loot',   selector: '#hs-loot-menu',         anchor: 'center', window: true },
];

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const MODE_CLASS = 'hsplus-layout-mode';
const HANDLE_CLASS = 'hsplus-layout-handle';
const FRAME_CLASS = 'hsplus-layout-frame';
const OVERLAY_ID = 'hsplus-layout-overlay';
const CORNERS = ['nw', 'ne', 'sw', 'se'];
const IDENTITY = Object.freeze({ dx: 0, dy: 0, scale: 1 });

let store = { shared: {}, accounts: {} }; // from the main process
let pendingStore = null;   // broadcast that arrived mid-drag; applied when the drag ends
let sharedLayout = true;   // setting "Shared Interface Layout"
let enabled = true;
let modifier = 'Alt';      // 'Alt' | 'Control' | 'Shift'
let modeActive = false;
let drag = null;           // active drag/resize gesture

// ---- settings --------------------------------------------------------------------------------

async function loadSettings() {
    try {
        const [on, mod, shared] = await Promise.all([
            window.settings.get('Interface', 'Movable Interface'),
            window.settings.get('Interface', 'Layout Modifier Key'),
            window.settings.get('Interface', 'Shared Interface Layout'),
        ]);
        enabled = on !== false;
        modifier = ['Alt', 'Control', 'Shift'].includes(mod) ? mod : 'Alt';
        sharedLayout = shared !== false;
        if (!enabled) setMode(false);
        applyAll(); // the active scope may have changed
    } catch {
        // defaults
    }
}

// ---- which layout applies: the shared one, or this character's ------------------------------

/** Logged-in character name, from the title userHelper sets; '' at the login screen. */
function accountName() {
    return accountNameFromTitle(document.title);
}

/** 'shared', or the character name when per-account layouts are on (shared until logged in). */
function scope() {
    if (sharedLayout) return 'shared';
    return accountName() || 'shared';
}

/** The panel map being viewed/edited right now (created on demand for a new character). */
function activeLayout() {
    const scopeKey = scope();
    if (scopeKey === 'shared') return store.shared;
    if (!store.accounts[scopeKey]) store.accounts[scopeKey] = {};
    return store.accounts[scopeKey];
}

/** A store as sent by main, or an empty one if the payload is missing/legacy-shaped. */
function normalizeStore(s) {
    return s && s.shared ? s : { shared: {}, accounts: {} };
}

/** Whether the configured modifier key is down in this mouse/keyboard event. */
function modifierHeld(e) {
    return modifier === 'Alt' ? e.altKey : modifier === 'Control' ? e.ctrlKey : e.shiftKey;
}

// ---- apply -----------------------------------------------------------------------------------

function panelEl(p) {
    return document.querySelector(p.selector);
}

/**
 * How the game centres a pop-up window right now. Above 1200×800 it adds the
 * `hs-center-menu--*-centered` classes, whose CSS is `left/top: 50%` plus a `translate(-50%)`
 * transform; below that (a multibox tile) it sets explicit left/top instead and the classes are
 * absent. It re-decides on every resize. Our inline transform replaces the CSS one, so the
 * -50% translate has to be carried in it (transformFor) and taken out of the layout box
 * (naturalBox). Returns '' for everything that is not centred this way.
 */
function centring(el) {
    const cl = el.classList;
    return (cl.contains('hs-center-menu--horizontally-centered') ? 'x' : '') +
        (cl.contains('hs-center-menu--vertically-centered') ? 'y' : '');
}

function transformFor(l, base = '') {
    if (!l) return ''; // no layout: the game's own CSS transform (if any) applies again
    const centre = base ? `translate(${base.includes('x') ? -50 : 0}%, ${base.includes('y') ? -50 : 0}%) ` : '';
    return `${centre}translate(${l.dx}px, ${l.dy}px) scale(${l.scale})`;
}

/**
 * The element's layout box with NO transform applied, in screen px. Built from offsetLeft/Top/
 * Width/Height (layout values that CSS transforms never touch) plus the offset parent's rect.
 * Never measure by clearing the transform: the game puts `transition: transform .1s !important`
 * on its HUD buttons, so such a read returns a mid-animation box and the error compounds.
 */
function naturalBox(el) {
    const parent = el.offsetParent || document.documentElement;
    const pr = parent.getBoundingClientRect();
    // A game-centred window's layout box starts at 50%; its own -50% translate (which we keep
    // in front of our transform) is part of where the user sees it, so it counts as natural.
    const base = centring(el);
    const left = pr.left + el.offsetLeft - (base.includes('x') ? el.offsetWidth / 2 : 0);
    const top = pr.top + el.offsetTop - (base.includes('y') ? el.offsetHeight / 2 : 0);
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
}

function cornerPoint(r, corner) {
    if (corner === 'center') return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    const [cy, cx] = corner.split(' ');
    return { x: cx === 'right' ? r.right : r.left, y: cy === 'bottom' ? r.bottom : r.top };
}

/** Screen point of the panel's anchor corner with no transform applied. */
function naturalAnchor(p, el) {
    return cornerPoint(naturalBox(el), p.anchor);
}

/** Where a natural-space point P of panel `p` currently is on screen, given its layout. */
function mapPoint(p, el, pt, l) {
    const a = naturalAnchor(p, el);
    const t = l || IDENTITY;
    return { x: a.x + t.dx + t.scale * (pt.x - a.x), y: a.y + t.dy + t.scale * (pt.y - a.y) };
}

/** Inverse of mapPoint: a screen point back into the panel's natural space. */
function unmapPoint(p, el, pt, l) {
    const a = naturalAnchor(p, el);
    const t = l || IDENTITY;
    return { x: a.x + (pt.x - a.x - t.dx) / t.scale, y: a.y + (pt.y - a.y - t.dy) / t.scale };
}

/**
 * Screen rect of a descendant, cut down to what is actually visible: intersected with every
 * ancestor up to (and including) the panel that clips its overflow. The minimap container is
 * `overflow: hidden` around two map-tile divs the size of the whole loaded map region (offset to
 * negative left/top and rotated with the camera), so without clipping the frame would surround
 * the hidden map instead of the visible square. `clips` caches each ancestor's clip rect per call.
 */
function visibleRect(c, el, clips) {
    let r = c.getBoundingClientRect();
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (let a = c.parentElement; a; a = a.parentElement) {
        let clip = clips.get(a);
        if (clip === undefined) {
            const cs = getComputedStyle(a);
            clip = (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') ? a.getBoundingClientRect() : null;
            clips.set(a, clip);
        }
        if (clip) {
            left = Math.max(left, clip.left); top = Math.max(top, clip.top);
            right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
            if (right <= left || bottom <= top) return null;
        }
        if (a === el) break;
    }
    return { left, top, right, bottom };
}

/**
 * The panel's natural bounds as the user sees them: its own layout box UNITED with every visible
 * descendant's box. Some containers (the inventory/skills window) are a near-empty flex box whose
 * menus overflow it, so the element's own box would give a tiny outline and unreachable handles.
 * Descendants inherit the panel's transform, so their screen rects are mapped back through it.
 * Descendants hidden by an overflow-clipping ancestor (the minimap's map tiles) do not count.
 */
function naturalBounds(p, el) {
    const l = activeLayout()[p.key];
    let box = naturalBox(el);
    // Pop-up windows are fixed-size `overflow: hidden` boxes: their own box is exactly what is
    // visible, and the bank has hundreds of item cells that would be measured per pointermove.
    if (p.window) return box;
    let { left, top, right, bottom } = box;
    const clips = new Map();
    for (const c of el.querySelectorAll('*')) {
        if (!(c instanceof HTMLElement) || c.offsetWidth === 0 || c.offsetHeight === 0) continue;
        const cs = getComputedStyle(c);
        if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const r = visibleRect(c, el, clips);
        if (!r) continue;
        const p1 = unmapPoint(p, el, { x: r.left, y: r.top }, l);
        const p2 = unmapPoint(p, el, { x: r.right, y: r.bottom }, l);
        left = Math.min(left, p1.x); top = Math.min(top, p1.y);
        right = Math.max(right, p2.x); bottom = Math.max(bottom, p2.y);
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Screen-space box of the panel's visible bounds under its current transform. */
function screenBounds(p, el) {
    const nat = naturalBounds(p, el);
    const l = activeLayout()[p.key];
    const tl = mapPoint(p, el, { x: nat.left, y: nat.top }, l);
    const br = mapPoint(p, el, { x: nat.right, y: nat.bottom }, l);
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y, width: br.x - tl.x, height: br.y - tl.y };
}

/**
 * Combined scale of every OTHER panel that contains `el` in the DOM (normally 1; the compass
 * or minimap toggle may live inside the minimap container). A nested element already inherits
 * its parent's transform, so pointer deltas must be divided by this to land where the cursor is.
 */
function containerScale(el) {
    let scale = 1;
    for (const q of PANELS) {
        const qel = panelEl(q);
        if (qel && qel !== el && qel.contains(el)) scale *= activeLayout()[q.key]?.scale || 1;
    }
    return scale;
}

function applyPanel(p) {
    const el = panelEl(p);
    if (!el) return;
    const l = activeLayout()[p.key];
    const base = p.window ? centring(el) : '';
    el.style.transformOrigin = p.anchor;
    el.style.transform = transformFor(l, base);
    el.dataset.hsplusPanel = p.key;
    // checkPanels re-applies when the game switches a window between class centring and
    // explicit left/top (it does so on resize), because the base translate is baked in above.
    if (p.window) el.dataset.hsplusBase = base;

    // Followers get the same translate+scale, but scaled about the LEADER's anchor point
    // (expressed in their own box), so they stay rigidly attached while the leader resizes.
    // A follower that is a DOM descendant of the leader already inherits the leader's
    // transform; giving it another one would move it twice as far.
    if (p.followers) {
        const anchor = naturalAnchor(p, el);
        for (const sel of p.followers) {
            const f = document.querySelector(sel);
            if (!f) continue;
            if (el.contains(f)) {
                f.style.transform = '';
                f.style.transformOrigin = '';
                f.dataset.hsplusFollower = p.key;
                continue;
            }
            const fr = naturalBox(f);
            f.style.transformOrigin = `${anchor.x - fr.left}px ${anchor.y - fr.top}px`;
            f.style.transform = transformFor(l);
            f.dataset.hsplusFollower = p.key;
        }
    }
}

function applyAll() {
    for (const p of PANELS) applyPanel(p);
    positionHandles();
}

function persist() {
    window.uiLayout.set(scope(), activeLayout());
}

// ---- edit mode (modifier held): outlines + corner handles ---------------------------------
//
// Handles live in a fixed full-screen overlay, NOT inside the panels: a child of a scaled panel
// would scale with it (tiny at 50%, huge at 300%). They are repositioned from each panel's
// bounding rect, so they stay the same size and are always easy to grab.

function overlay() {
    let o = document.getElementById(OVERLAY_ID);
    if (!o) {
        o = document.createElement('div');
        o.id = OVERLAY_ID;
        document.body.appendChild(o);
    }
    return o;
}

function ensureHandles(p) {
    const o = overlay();
    if (o.querySelector(`[data-panel="${p.key}"]`)) return;
    const frame = document.createElement('div');
    frame.className = FRAME_CLASS;
    frame.dataset.panel = p.key;
    o.appendChild(frame);
    for (const corner of CORNERS) {
        const h = document.createElement('div');
        h.className = `${HANDLE_CLASS} ${HANDLE_CLASS}--${corner}`;
        h.dataset.corner = corner;
        h.dataset.panel = p.key;
        h.title = 'Drag to resize';
        o.appendChild(h);
    }
}

/** The overlay's frame + 4 handles for panel `p`. */
function handleItems(p) {
    const o = document.getElementById(OVERLAY_ID);
    return o ? o.querySelectorAll(`[data-panel="${p.key}"]`) : [];
}

/** Lay out one panel's frame and corner handles over its current screen bounds. */
function positionPanelHandles(p, el, items) {
    const r = screenBounds(p, el);
    const visible = r.width > 0 && r.height > 0 && el.offsetParent !== null;
    for (const h of items) {
        h.style.display = visible ? 'block' : 'none';
        if (h.classList.contains(FRAME_CLASS)) {
            h.style.left = `${r.left}px`;
            h.style.top = `${r.top}px`;
            h.style.width = `${r.width}px`;
            h.style.height = `${r.height}px`;
            h.classList.toggle('dragging', !!(drag && drag.p === p));
            continue;
        }
        const c = h.dataset.corner;
        h.style.left = `${c.endsWith('w') ? r.left : r.right}px`;
        h.style.top = `${c.startsWith('n') ? r.top : r.bottom}px`;
    }
}

function positionHandles() {
    const o = document.getElementById(OVERLAY_ID);
    if (!o || !modeActive) return;
    for (const p of PANELS) {
        const items = o.querySelectorAll(`[data-panel="${p.key}"]`);
        if (!items.length) continue;
        const el = panelEl(p);
        if (!el) {
            // Panel gone (closed/re-created by the game): don't leave its frame frozen on screen.
            for (const h of items) h.style.display = 'none';
            continue;
        }
        positionPanelHandles(p, el, items);
    }
}

function setMode(on) {
    if (on && !enabled) return;
    if (modeActive === on) return;
    modeActive = on;
    const mask = document.querySelector('#hs-screen-mask');
    if (mask) mask.classList.toggle(MODE_CLASS, on);
    const o = overlay();
    o.classList.toggle('active', on);
    if (on) {
        for (const p of PANELS) {
            if (panelEl(p)) {
                applyPanel(p);
                ensureHandles(p);
            }
        }
        positionHandles();
    }
}

// ---- gestures --------------------------------------------------------------------------------

function panelFromEvent(e) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return null;
    const handle = target.closest(`.${HANDLE_CLASS}`);
    if (handle) {
        const p = PANELS.find(x => x.key === handle.dataset.panel);
        const el = p && panelEl(p);
        return el ? { p, el, handle } : null;
    }
    for (const p of PANELS) {
        const el = panelEl(p);
        if (el && (el === target || el.contains(target))) return { p, el };
        // A press on a follower (compass, minimap toggle) moves its leader.
        for (const sel of p.followers || []) {
            const f = document.querySelector(sel);
            if (el && f && (f === target || f.contains(target))) return { p, el };
        }
    }
    return null;
}

function onPointerDown(e) {
    if (!enabled || e.button !== 0 || !modifierHeld(e)) return;
    const hit = panelFromEvent(e);
    if (!hit) return;
    const { p, el, handle } = hit;
    e.preventDefault();
    e.stopImmediatePropagation(); // the game must not see this as a click/walk/use

    const current = activeLayout()[p.key] || IDENTITY;
    const ps = containerScale(el); // >1 when this panel sits inside a scaled-up panel

    if (handle) {
        // Stretch from the grabbed corner: the OPPOSITE corner stays exactly where it is, like
        // resizing in MS Paint. The CSS transform always scales about the panel's anchor corner,
        // so as the scale changes we shift the translation to keep the opposite corner pinned.
        const c = handle.dataset.corner; // nw | ne | sw | se
        const opposite = `${c.startsWith('n') ? 'bottom' : 'top'} ${c.endsWith('w') ? 'right' : 'left'}`;
        const nat = naturalBounds(p, el);     // what the user sees, not the bare container
        const a = naturalAnchor(p, el);         // scale pivot = the container's anchor corner
        const o = cornerPoint(nat, opposite);   // natural position of the pinned (visible) corner
        // Where that corner is on screen right now, computed (not measured, see naturalBox).
        const pinned = mapPoint(p, el, o, current);
        drag = {
            kind: 'scale', p, el, ps,
            baseW: nat.width, baseH: nat.height,
            pinned,
            // Pinned corner relative to the pivot in the panel's own px (screen px / parent
            // scale): translation shift per unit of scale change.
            lever: { x: (o.x - a.x) / ps, y: (o.y - a.y) / ps },
            start: { ...current },
        };
    } else {
        drag = { kind: 'move', p, el, x0: e.clientX, y0: e.clientY, ps, start: { ...current } };
    }
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
}

function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const { p, start } = drag;
    if (drag.kind === 'move') {
        activeLayout()[p.key] = {
            ...start,
            dx: start.dx + (e.clientX - drag.x0) / drag.ps,
            dy: start.dy + (e.clientY - drag.y0) / drag.ps,
        };
    } else {
        // New size = distance from the pinned corner to the pointer; keep the aspect ratio by
        // taking whichever axis the user stretched further. baseW/baseH are natural px, the
        // pointer distance is screen px, so a parent panel's scale has to come out first.
        const w = Math.abs(e.clientX - drag.pinned.x);
        const h = Math.abs(e.clientY - drag.pinned.y);
        const raw = Math.max(w / (drag.baseW * drag.ps), h / (drag.baseH * drag.ps));
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(raw) ? raw : start.scale));
        // Opposite corner on screen = anchor + T + scale * lever; solve T so it stays put.
        const ds = start.scale - scale;
        activeLayout()[p.key] = {
            dx: start.dx + ds * drag.lever.x,
            dy: start.dy + ds * drag.lever.y,
            scale,
        };
    }
    applyPanel(p);
    // Only the dragged panel moved; measuring all eight (chat has hundreds of nodes) per
    // pointermove is what made dragging stutter.
    if (modeActive) positionPanelHandles(p, drag.el, handleItems(p));
}

function sameLayout(a, b) {
    return a.dx === b.dx && a.dy === b.dy && a.scale === b.scale;
}

/** Finish the active gesture: from pointerup/cancel, or window blur mid-drag. */
function endDrag() {
    if (!drag) return;
    const finished = drag;
    drag = null;
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);

    const key = finished.p.key;
    const edited = activeLayout()[key];
    if (pendingStore) {
        // Another window wrote while we were dragging: take its store, keep our panel's edit.
        store = pendingStore;
        pendingStore = null;
        if (edited) activeLayout()[key] = edited;
        else delete activeLayout()[key];
        applyAll();
    } else {
        positionHandles();
    }
    // A modifier+double-click fires two zero-delta moves before the reset; nothing to save.
    if (!sameLayout(edited || IDENTITY, finished.start)) persist();
}

function onPointerUp(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    endDrag();
}

function onDoubleClick(e) {
    if (!enabled || !modifierHeld(e)) return;
    const hit = panelFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    delete activeLayout()[hit.p.key];
    applyPanel(hit.p);
    positionHandles();
    persist();
}

// Swallow the click/contextmenu the game would otherwise get from a modifier-held press.
function swallowIfEditing(e) {
    if (!enabled || !modifierHeld(e)) return;
    if (panelFromEvent(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}

/** Typing into chat or a text box: a Shift (or Alt) press there is text entry, not edit mode. */
function isTextEntry(target) {
    return target instanceof Element &&
        (target.matches('input, textarea') || target.isContentEditable);
}

// A lone Alt is Windows' menu-bar accelerator. If the page does not claim the key events,
// Chromium falls back to that: the first Alt+click is swallowed (no pointerdown, no keyup
// reaches the page) and the next click arrives as a window blur, so the user had to tap
// Alt once before an Alt+drag would take. preventDefault marks Alt as handled; Shift and
// Control have no such role and are left alone.
function claimAlt(e) {
    if (e.key === 'Alt' && modifier === 'Alt') e.preventDefault();
}

function onKeyDown(e) {
    claimAlt(e);
    if (e.key === modifier && !isTextEntry(e.target)) setMode(true);
}
// keyup only ever turns the mode OFF, so it is honoured everywhere: focus may have moved into
// a text box between the press and the release, and the mode must not stay stuck on.
function onKeyUp(e) {
    claimAlt(e);
    if (e.key === modifier) setMode(false);
}

// ---- boot --------------------------------------------------------------------------------------

export function initUiLayout() {
    if (!window.uiLayout) return;

    void loadSettings();
    window.electron.ipcRenderer.on('settings:changed', () => { void loadSettings(); });

    window.uiLayout.get().then(saved => {
        store = normalizeStore(saved);
        applyAll();
    });
    window.uiLayout.onChanged(next => {
        // Main broadcasts to every window EXCEPT the writer, so this is always someone else's
        // edit. Mid-drag it would clobber the panel being dragged; hold it until the drag ends.
        if (drag) {
            pendingStore = normalizeStore(next);
            return;
        }
        store = normalizeStore(next);
        applyAll();
    });

    // Per-character layouts switch when the login name changes (title set by userHelper).
    let lastScope = scope();
    new MutationObserver(() => {
        const scopeKey = scope();
        if (scopeKey !== lastScope) {
            lastScope = scopeKey;
            applyAll();
        }
    }).observe(document.head, { childList: true, subtree: true, characterData: true });

    // The HUD is built by the game after login and some panels (and followers) are re-created
    // when they are toggled; re-apply to any element we have not stamped yet. Chat and nameplates
    // mutate constantly, so the check runs at most once per frame.
    let queued = false;
    let lastPresent = '';
    const checkPanels = () => {
        queued = false;
        let fresh = false;
        let present = '';
        for (const p of PANELS) {
            const el = panelEl(p);
            if (!el) continue;
            present += p.key + ' ';
            const unstamped = el.dataset.hsplusPanel !== p.key ||
                (p.window && el.dataset.hsplusBase !== centring(el)) ||
                (p.followers || []).some(sel => {
                    const f = document.querySelector(sel);
                    return f && f.dataset.hsplusFollower !== p.key;
                });
            if (unstamped) {
                applyPanel(p);
                if (modeActive) ensureHandles(p);
                fresh = true;
            }
        }
        // A pop-up window closed while editing: its frame must not stay frozen on screen.
        const closed = present !== lastPresent;
        lastPresent = present;
        if ((fresh || closed) && modeActive) {
            // The mask itself may have been re-created by the game along with the panel.
            const mask = document.querySelector('#hs-screen-mask');
            if (mask) mask.classList.add(MODE_CLASS);
            positionHandles();
        }
    };
    const observer = new MutationObserver(() => {
        if (!queued) {
            queued = true;
            requestAnimationFrame(checkPanels);
        }
    });
    window.addEventListener('resize', positionHandles);
    // `class` is watched for the windows' centring classes (chat and nameplates churn classes
    // too, but the check is coalesced to one per frame and only re-applies what changed).
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('click', swallowIfEditing, true);
    window.addEventListener('contextmenu', swallowIfEditing, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    // Alt+Tab away mid-drag: no pointerup ever comes, so finish the gesture here.
    window.addEventListener('blur', () => {
        endDrag();
        setMode(false);
    });
}
