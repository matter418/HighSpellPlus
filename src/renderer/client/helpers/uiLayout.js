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
// Panels are the game's own absolutely positioned HUD containers; we only ever add a CSS
// transform, so the game keeps laying them out as usual and hit-testing follows the
// transform. The layout is per client (stored by the main process) and every change is
// pushed live to all windows and multi-account views.

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
];

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const MODE_CLASS = 'hsplus-layout-mode';
const HANDLE_CLASS = 'hsplus-layout-handle';
const OVERLAY_ID = 'hsplus-layout-overlay';
const CORNERS = ['nw', 'ne', 'sw', 'se'];

let store = { shared: {}, accounts: {} }; // from the main process
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

/** Logged-in character name, from the title userHelper sets ("Highspell+ - <name>"); '' at the login screen. */
function accountName() {
    const m = /^Highspell\+\s*-\s*(.+)$/.exec(document.title || '');
    return m ? m[1].trim() : '';
}

/** 'shared', or the character name when per-account layouts are on (shared until logged in). */
function scope() {
    if (sharedLayout) return 'shared';
    return accountName() || 'shared';
}

/** The panel map being viewed/edited right now (created on demand for a new character). */
function L() {
    const sc = scope();
    if (sc === 'shared') return store.shared;
    if (!store.accounts[sc]) store.accounts[sc] = {};
    return store.accounts[sc];
}

function modifierHeld(e) {
    return modifier === 'Alt' ? e.altKey : modifier === 'Control' ? e.ctrlKey : e.shiftKey;
}

// ---- apply -----------------------------------------------------------------------------------

function panelEl(p) {
    return document.querySelector(p.selector);
}

function transformFor(l) {
    return l ? `translate(${l.dx}px, ${l.dy}px) scale(${l.scale})` : '';
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
    const left = pr.left + el.offsetLeft;
    const top = pr.top + el.offsetTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
}

function cornerPoint(r, corner) {
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
    const t = l || { dx: 0, dy: 0, scale: 1 };
    return { x: a.x + t.dx + t.scale * (pt.x - a.x), y: a.y + t.dy + t.scale * (pt.y - a.y) };
}

/** Inverse of mapPoint: a screen point back into the panel's natural space. */
function unmapPoint(p, el, pt, l) {
    const a = naturalAnchor(p, el);
    const t = l || { dx: 0, dy: 0, scale: 1 };
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
    const l = L()[p.key];
    let box = naturalBox(el);
    let { left, top, right, bottom } = box;
    const clips = new Map();
    for (const c of el.querySelectorAll('*')) {
        if (!(c instanceof HTMLElement) || c.offsetWidth === 0 || c.offsetHeight === 0) continue;
        if (c.classList.contains(HANDLE_CLASS)) continue;
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
    const l = L()[p.key];
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
        if (qel && qel !== el && qel.contains(el)) scale *= L()[q.key]?.scale || 1;
    }
    return scale;
}

function applyPanel(p) {
    const el = panelEl(p);
    if (!el) return;
    const l = L()[p.key];
    el.style.transformOrigin = p.anchor;
    el.style.transform = transformFor(l);
    el.dataset.hsplusPanel = p.key;

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
    window.uiLayout.set(scope(), L());
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
    frame.className = 'hsplus-layout-frame';
    frame.dataset.panel = p.key;
    frame.dataset.frame = '1';
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

function positionHandles() {
    const o = document.getElementById(OVERLAY_ID);
    if (!o || !modeActive) return;
    for (const p of PANELS) {
        const el = panelEl(p);
        const items = o.querySelectorAll(`[data-panel="${p.key}"]`);
        if (!el || !items.length) continue;
        const r = screenBounds(p, el);
        const visible = r.width > 0 && r.height > 0 && el.offsetParent !== null;
        for (const h of items) {
            h.style.display = visible ? 'block' : 'none';
            if (h.dataset.frame) {
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

    const current = L()[p.key] || { dx: 0, dy: 0, scale: 1 };
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
            kind: 'scale', p, el,
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
    el.classList.add('hsplus-layout-dragging');
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
        L()[p.key] = {
            ...start,
            dx: start.dx + (e.clientX - drag.x0) / drag.ps,
            dy: start.dy + (e.clientY - drag.y0) / drag.ps,
        };
    } else {
        // New size = distance from the pinned corner to the pointer; keep the aspect ratio by
        // taking whichever axis the user stretched further.
        const w = Math.abs(e.clientX - drag.pinned.x);
        const h = Math.abs(e.clientY - drag.pinned.y);
        const raw = Math.max(w / drag.baseW, h / drag.baseH);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(raw) ? raw : start.scale));
        // Opposite corner on screen = anchor + T + scale * lever; solve T so it stays put.
        const ds = start.scale - scale;
        L()[p.key] = {
            dx: start.dx + ds * drag.lever.x,
            dy: start.dy + ds * drag.lever.y,
            scale,
        };
    }
    applyPanel(p);
    positionHandles();
}

function onPointerUp(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drag.el.classList.remove('hsplus-layout-dragging');
    const finished = drag;
    drag = null;
    console.log(`[Highspell+ Layout] ${finished.kind} ${finished.p.key} -> ${JSON.stringify(L()[finished.p.key] || null)}`);
    if (finished.p.key === 'minimap' || finished.p.key === 'compass') dumpStructure(`after ${finished.kind} ${finished.p.key}`);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    persist();
}

function onDoubleClick(e) {
    if (!enabled || !modifierHeld(e)) return;
    const hit = panelFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    delete L()[hit.p.key];
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

function onKeyDown(e) {
    if (e.key === modifier) setMode(true);
}
function onKeyUp(e) {
    if (e.key === modifier) setMode(false);
}

// ---- diagnostics ---------------------------------------------------------------------------------
// Logged through console (which electron-log mirrors into main.log) so the real HUD structure can
// be read from the log file without a debugger: parent chains, inline styles and computed
// positioning of every panel and follower, plus the numbers behind each drag.

const DEBUG_SELECTORS = ['#hs-minimap-container', '#hs-toggle-minimap-button', '#hs-compass-button', '#hs-logout-button'];

function describe(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const chain = [];
    for (let n = el.parentElement; n && chain.length < 6; n = n.parentElement) {
        chain.push(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''}`);
    }
    const r = el.getBoundingClientRect();
    return {
        id: el.id,
        parents: chain,
        inlineStyle: el.getAttribute('style'),
        computed: {
            position: cs.position, top: cs.top, left: cs.left, right: cs.right, bottom: cs.bottom,
            width: cs.width, height: cs.height, transform: cs.transform, transformOrigin: cs.transformOrigin,
            transition: cs.transition, margin: cs.margin,
        },
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
}

function dumpStructure(reason) {
    if (localStorage.getItem('HSPLUS_LAYOUT_DEBUG') !== '1') return;
    try {
        const out = {};
        for (const sel of DEBUG_SELECTORS) out[sel] = describe(document.querySelector(sel));
        const entry = { reason, scope: scope(), layout: L(), elements: out };
        console.log(`[Highspell+ Layout] ${reason} ${JSON.stringify(out)}`);
        window.uiLayout.debug?.(entry);
    } catch (e) {
        console.log('[Highspell+ Layout] dump failed', String(e));
    }
}
window.__hsplusLayoutDump = dumpStructure;

// ---- boot --------------------------------------------------------------------------------------

export function initUiLayout() {
    if (!window.uiLayout) return;

    void loadSettings();
    window.electron.ipcRenderer.on('settings:changed', () => { void loadSettings(); });

    window.uiLayout.get().then(saved => {
        store = saved && saved.shared ? saved : { shared: {}, accounts: {} };
        applyAll();
    });
    window.uiLayout.onChanged(next => {
        if (drag) return; // we're the one editing; our own write comes back later anyway
        store = next && next.shared ? next : { shared: {}, accounts: {} };
        applyAll();
    });

    // Per-character layouts switch when the login name changes (title set by userHelper).
    let lastScope = scope();
    new MutationObserver(() => {
        const sc = scope();
        if (sc !== lastScope) {
            lastScope = sc;
            applyAll();
        }
    }).observe(document.head, { childList: true, subtree: true, characterData: true });

    // The HUD is built by the game after login and some panels are re-created when they are
    // toggled; re-apply to any panel element we have not stamped yet.
    const observer = new MutationObserver(() => {
        let fresh = false;
        for (const p of PANELS) {
            const el = panelEl(p);
            if (el && el.dataset.hsplusPanel !== p.key) {
                applyPanel(p);
                if (modeActive) ensureHandles(p);
                fresh = true;
            }
        }
        if (fresh && modeActive) {
            const mask = document.querySelector('#hs-screen-mask');
            if (mask) mask.classList.add(MODE_CLASS);
            positionHandles();
        }
        const mask = document.querySelector('#hs-screen-mask');
        if (mask && !mask.dataset.hsplusDumped && document.querySelector('#hs-minimap-container')) {
            mask.dataset.hsplusDumped = '1';
            setTimeout(() => dumpStructure('HUD ready'), 1500);
        }
    });
    window.addEventListener('resize', positionHandles);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('click', swallowIfEditing, true);
    window.addEventListener('contextmenu', swallowIfEditing, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => setMode(false));
}
