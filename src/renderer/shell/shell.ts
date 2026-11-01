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

// Multi-account shell page: title bar + account strip/dock. The game itself is not in this
// document; the main process positions one WebContentsView per account over #content.
//
// Child views are always drawn ABOVE this page, so nothing here may overlap #content: no
// popovers or dropdowns into the game area. Thumbnails therefore live only in the dock cards,
// and tab chips rely on native title tooltips. Keyboard shortcuts are handled in the main
// process (before-input-event) for this page and every game view alike.
//
// Accounts are listed in the order main sends them (state.accounts), which the user can change
// by dragging a chip, card or rail button; the number on each one is its position in that order
// (and its Ctrl+N shortcut), not its slot. Slots stay the stable ids used over IPC.

import '@iconify/iconify';
import type { AccountState, ShellAccountInfo, ShellConfig, ShellState } from '../../shared/shellTypes';

const STATE_LABEL: Record<AccountState, string> = {
    loading: 'Loading…',
    login: 'Login screen',
    ingame: 'In game',
    crashed: 'Crashed',
};

// What a background account wants attention for (account:attention kinds sent by the game views).
const ATTENTION_LABEL: Record<string, string> = {
    idle: 'Idle!',
    logout: 'Logging out soon!',
};

// Shortcut text for tooltips and the dock footer only; the bindings live in main (before-input-event).
const SHORTCUT = {
    collapse: 'Ctrl+`',
    add: 'Ctrl+Shift+T',
    switchAll: 'Ctrl+1…6',
    switchTo: (position: number) => `Ctrl+${position}`,
};

// The collapse chevron, used by the title-bar button and the dock header. Points up; CSS rotates it.
const CHEVRON_SVG =
    '<svg class="collapse-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';

// Only until getConfig() resolves; main's readConfig() is authoritative. `max`, `fps` and
// `isolateSessions` are never read on this page (state.max and main own them) but the shared type has them.
let config: ShellConfig = {
    layout: 'top',
    previews: true,
    startCollapsed: false,
    fps: 15,
    isolateSessions: false,
    attentionColor: '#f9f449',
    max: 6,
};
let state: ShellState = { activeSlot: 0, max: 6, accounts: [] };
let collapsed = false;
const previews = new Map<number, string>();

const body = document.body;
const content = document.getElementById('content')!;
const stripTop = document.getElementById('strip-top')!;
const stripBottom = document.getElementById('strip-bottom')!;
const dockLeft = document.getElementById('dock-left')!;
const dockRight = document.getElementById('dock-right')!;

// ---- title bar wiring (same IPC as the single-account title bar) -------------------------

const isDarwin = window.electron.process.platform === 'darwin';
if (isDarwin) {
    document.getElementById('window-controls')?.remove();
} else {
    document.getElementById('darwin-spacer')?.remove();
}

document.getElementById('minimizeBtn')?.addEventListener('click', () => window.electron.ipcRenderer.send('minimize-window'));
document.getElementById('maximizeBtn')?.addEventListener('click', () => window.electron.ipcRenderer.send('toggle-maximize-window'));
document.getElementById('closeBtn')?.addEventListener('click', () => window.electron.ipcRenderer.send('close-window'));
document.getElementById('settingsBtn')?.addEventListener('click', () => window.electron.ipcRenderer.send('settings:open'));
document.getElementById('screenshotBtn')?.addEventListener('click', async () => {
    const res = await window.screenshot.capture();
    if (!res.ok) console.error('Screenshot failed:', res.error);
});

// #collapseBtn and #multiboxAdd are <a href="#"> like the other title-bar icons so index.css's
// `.highlite_titlebar a` rules (no-drag, flex, colour) cover them for free; hence preventDefault.
const collapseBtn = document.getElementById('collapseBtn');
if (collapseBtn) {
    collapseBtn.innerHTML = CHEVRON_SVG;
    collapseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleCollapsed();
    });
}
const multiboxAdd = document.getElementById('multiboxAdd');
if (multiboxAdd) {
    multiboxAdd.title = `Add account (${SHORTCUT.add})`;
    multiboxAdd.addEventListener('click', (e) => {
        e.preventDefault();
        window.shell.add();
    });
}

const warningIndicator = document.getElementById('warningIndicator')!;
const warningIcon = warningIndicator.querySelector('.warning-icon')!;
warningIndicator.addEventListener('click', (e) => {
    e.preventDefault();
    window.electron.ipcRenderer.send('show-console');
    warningIcon.classList.remove('warning', 'error');
    warningIndicator.style.display = 'none';
    // Game views only forward a console message when it escalates the indicator; tell them it is
    // cleared so the next warning is forwarded again (main relays this as account:warning-cleared).
    window.shell.clearWarning();
});
window.shell.onWarning(({ level }) => {
    if (level === 'error') {
        warningIcon.classList.remove('warning');
        warningIcon.classList.add('error');
    } else if (!warningIcon.classList.contains('error')) {
        warningIcon.classList.add('warning');
    }
    warningIndicator.style.display = 'flex';
});

// ---- layout: tell main where the game views go ----------------------------------------------

function pushContentBounds() {
    const r = content.getBoundingClientRect();
    window.shell.setContentBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    // Dock thumbnails are shaped like the game view they show (see .acct-thumb in shell.css).
    if (r.width > 0 && r.height > 0) body.style.setProperty('--view-aspect', `${r.width} / ${r.height}`);
}
// #content is flex: 1 both ways, so any window resize changes its size and the observer fires.
// Position-only moves (switching the dock from left to right) go through applyLayout().
new ResizeObserver(pushContentBounds).observe(content);

function isDock(): boolean {
    return config.layout === 'left' || config.layout === 'right';
}

function applyLayout() {
    // Only docks collapse (to a rail). A hidden tab strip helps nobody, so strips never do.
    if (!isDock()) collapsed = false;
    body.dataset.layout = config.layout;
    body.classList.toggle('collapsed', collapsed);
    body.classList.toggle('dock-layout', isDock());
    body.style.setProperty('--shell-attention', config.attentionColor);
    if (collapseBtn) {
        const label = `${collapsed ? 'Show' : 'Hide'} account ${isDock() ? 'dock' : 'bar'} (${SHORTCUT.collapse})`;
        collapseBtn.title = label;
        collapseBtn.setAttribute('aria-label', label);
    }
    pushContentBounds();
}

function toggleCollapsed() {
    if (!isDock()) return;
    collapsed = !collapsed;
    applyLayout();
    render();
}

// ---- drag to reorder ---------------------------------------------------------------------------

// True while a chip/card/rail button is being dragged; render() waits for the drop so a state
// broadcast (a title change, an idle flash) cannot rebuild the list under the pointer.
let reordering = false;
let renderPending = false;
// The click that ends a drag lands on the dragged item's select button; it must not switch accounts.
let swallowClick = false;

/**
 * Let the `[data-slot]` children of `container` be reordered by dragging along `axis`. The
 * dragged item is moved in the DOM as the pointer crosses its neighbours' midpoints (no ghost
 * element: the list itself is the preview), and the resulting slot order goes to main on drop.
 * Other children (the add button) keep their place after the items. Drag near an edge of a
 * scrolling container and it scrolls.
 */
function enableReorder(container: HTMLElement, axis: 'x' | 'y') {
    const DRAG_THRESHOLD = 6;
    const EDGE = 28;
    const EDGE_STEP = 10;
    let pressed: { item: HTMLElement; pointerId: number; x: number; y: number } | null = null;
    let dragged: HTMLElement | null = null;

    const items = () => Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-slot]'));
    const slotOrder = () => items().map(i => Number(i.dataset.slot));

    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || pressed) return;
        const target = e.target as HTMLElement;
        if (target.closest('.acct-close')) return; // the × is a click, never a drag handle
        const item = target.closest<HTMLElement>('[data-slot]');
        if (!item || item.parentElement !== container) return;
        pressed = { item, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    });

    container.addEventListener('pointermove', (e) => {
        if (!pressed || e.pointerId !== pressed.pointerId) return;
        if (!dragged) {
            if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < DRAG_THRESHOLD) return;
            dragged = pressed.item;
            reordering = true;
            dragged.classList.add('dragging');
            body.classList.add('reordering');
            container.setPointerCapture(e.pointerId);
        }
        const pos = axis === 'x' ? e.clientX : e.clientY;

        // Keep the list scrolling while the pointer sits at either end of it.
        const cr = container.getBoundingClientRect();
        const start = axis === 'x' ? cr.left : cr.top;
        const end = axis === 'x' ? cr.right : cr.bottom;
        if (pos < start + EDGE) scrollBy(container, axis, -EDGE_STEP);
        else if (pos > end - EDGE) scrollBy(container, axis, EDGE_STEP);

        const others = items().filter(i => i !== dragged);
        let index = 0;
        for (const o of others) {
            const r = o.getBoundingClientRect();
            const mid = axis === 'x' ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
            if (pos > mid) index++;
        }
        const current = items().indexOf(dragged);
        if (index === current) return;
        if (index < others.length) container.insertBefore(dragged, others[index]);
        else container.insertBefore(dragged, others[others.length - 1].nextSibling);
    });

    const finish = (e: PointerEvent) => {
        if (!pressed || e.pointerId !== pressed.pointerId) return;
        const before = state.accounts.map(a => a.slot);
        if (dragged) {
            dragged.classList.remove('dragging');
            body.classList.remove('reordering');
            if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
            swallowClick = true;
            setTimeout(() => { swallowClick = false; }, 0);
            const after = slotOrder();
            if (after.length === before.length && after.some((s, i) => s !== before[i])) {
                window.shell.reorder(after);
            }
        }
        pressed = null;
        dragged = null;
        reordering = false;
        if (renderPending) render();
    };
    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);
    container.addEventListener('click', (e) => {
        if (!swallowClick) return;
        e.stopPropagation();
        e.preventDefault();
    }, true);
}

function scrollBy(el: HTMLElement, axis: 'x' | 'y', delta: number) {
    if (axis === 'x') el.scrollLeft += delta;
    else el.scrollTop += delta;
}

// ---- rendering -------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function displayName(a: ShellAccountInfo): string {
    return a.name || `Account ${a.slot}`;
}

/** One line of status for tooltips and card labels; an alert outranks the connection state. */
function statusText(a: ShellAccountInfo): string {
    return (a.attention && ATTENTION_LABEL[a.attention]) || STATE_LABEL[a.state];
}

function switchTitle(a: ShellAccountInfo, position: number): string {
    return `${displayName(a)} — ${statusText(a)} (${SHORTCUT.switchTo(position)}; drag to reorder)`;
}

function dot(a: ShellAccountInfo): HTMLElement {
    return el('span', `acct-dot state-${a.state}`);
}

function closeButton(a: ShellAccountInfo): HTMLButtonElement {
    const b = el('button', 'acct-close', '×');
    b.type = 'button';
    b.title = `Close ${displayName(a)}`;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        window.shell.close(a.slot);
    });
    return b;
}

function selectButton(a: ShellAccountInfo, position: number, className: string, children: HTMLElement[]): HTMLButtonElement {
    const b = el('button', className);
    b.type = 'button';
    b.title = switchTitle(a, position);
    b.setAttribute('aria-label', `Switch to ${displayName(a)}`);
    for (const c of children) b.appendChild(c);
    b.addEventListener('click', () => window.shell.activate(a.slot));
    return b;
}

function addButton(compact: boolean): HTMLButtonElement | null {
    if (state.accounts.length >= state.max) return null;
    const b = el('button', 'acct-add');
    b.type = 'button';
    b.title = `Add account (${SHORTCUT.add})`;
    b.setAttribute('aria-label', 'Add account');
    b.textContent = compact ? '+' : '+ Add account';
    b.addEventListener('click', () => window.shell.add());
    return b;
}

function collapseButton(): HTMLButtonElement {
    const b = el('button', 'acct-dock-collapse');
    b.type = 'button';
    b.title = `${collapsed ? 'Expand' : 'Collapse'} dock (${SHORTCUT.collapse})`;
    b.setAttribute('aria-label', b.title);
    b.innerHTML = CHEVRON_SVG;
    b.addEventListener('click', toggleCollapsed);
    return b;
}

function countLabel(): HTMLElement {
    return el('span', 'acct-count', `${state.accounts.length} / ${state.max}`);
}

/** The scrolling chip row of a strip, created once per strip so its scroll position survives re-renders. */
function stripTabs(container: HTMLElement): HTMLElement {
    let tabs = container.querySelector<HTMLElement>('.acct-strip-tabs');
    if (tabs) return tabs;
    tabs = el('div', 'acct-strip-tabs');
    // A mouse wheel only scrolls vertically; the strip has nowhere to go but sideways.
    tabs.addEventListener('wheel', (e) => {
        if (e.deltaX !== 0 || e.deltaY === 0) return;
        e.preventDefault();
        tabs!.scrollLeft += e.deltaY;
    }, { passive: false });
    tabs.addEventListener('scroll', () => updateStripOverflow(tabs!));
    new ResizeObserver(() => updateStripOverflow(tabs!)).observe(tabs);
    enableReorder(tabs, 'x');
    container.appendChild(tabs);
    return tabs;
}

/** Edge fades show which way more chips are hiding. */
function updateStripOverflow(tabs: HTMLElement) {
    tabs.classList.toggle('overflow-left', tabs.scrollLeft > 1);
    tabs.classList.toggle('overflow-right', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1);
}

/** Scroll the strip so the active chip is fully on screen (after a switch via Ctrl+N or a close). */
function revealActiveChip(tabs: HTMLElement) {
    const chip = tabs.querySelector<HTMLElement>('.acct-chip.active');
    if (!chip) return;
    const left = chip.offsetLeft; // .acct-strip-tabs is the chips' offsetParent
    const right = left + chip.offsetWidth;
    if (left < tabs.scrollLeft) tabs.scrollLeft = left - 4;
    else if (right > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = right - tabs.clientWidth + 4;
}

function renderStrip(container: HTMLElement) {
    const tabs = stripTabs(container);
    tabs.replaceChildren();
    state.accounts.forEach((a, i) => {
        const chip = el('div', `acct-chip${a.active ? ' active' : ''}${a.attention ? ' attention' : ''}`);
        chip.dataset.slot = String(a.slot);
        chip.appendChild(selectButton(a, i + 1, 'acct-select', [
            el('span', 'acct-num', String(i + 1)),
            el('span', 'acct-name', displayName(a)),
            dot(a),
        ]));
        chip.appendChild(closeButton(a));
        tabs.appendChild(chip);
    });
    // Everything after the chip row is rebuilt each time (the add button comes and goes with the count).
    for (const extra of Array.from(container.children)) {
        if (extra !== tabs) extra.remove();
    }
    const add = addButton(true);
    if (add) container.appendChild(add);
    container.appendChild(countLabel());
    revealActiveChip(tabs);
    updateStripOverflow(tabs);
}

function renderDock(container: HTMLElement) {
    container.replaceChildren();

    const header = el('div', 'acct-dock-header');
    const title = el('div', 'acct-dock-title');
    title.appendChild(el('span', undefined, 'Accounts'));
    title.appendChild(countLabel());
    header.appendChild(title);
    header.appendChild(collapseButton());
    container.appendChild(header);

    const list = el('div', 'acct-dock-list');
    enableReorder(list, 'y');
    state.accounts.forEach((a, i) => {
        const flags = `${a.active ? ' active' : ''}${a.attention ? ' attention' : ''}`;
        if (collapsed) {
            const btn = selectButton(a, i + 1, `acct-rail-btn${flags}`, [el('span', 'acct-num', String(i + 1)), dot(a)]);
            btn.dataset.slot = String(a.slot);
            list.appendChild(btn);
            return;
        }

        const card = el('div', `acct-card${flags}`);
        card.dataset.slot = String(a.slot);

        const thumb = el('div', 'acct-thumb');
        const src = previews.get(a.slot);
        if (src && config.previews) {
            const img = el('img');
            img.src = src;
            img.alt = '';
            img.draggable = false; // native image drag would fight the reorder drag
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el('span', undefined, a.active ? 'Showing in main view' : statusText(a)));
        }
        if (a.active) thumb.appendChild(el('span', 'acct-main', 'MAIN'));

        const meta = el('div', 'acct-meta');
        meta.appendChild(el('span', 'acct-num', String(i + 1)));
        meta.appendChild(dot(a));
        meta.appendChild(el('span', 'acct-name', displayName(a)));
        meta.appendChild(el('span', 'acct-state', statusText(a)));

        card.appendChild(selectButton(a, i + 1, 'acct-select', [thumb, meta]));
        card.appendChild(closeButton(a));
        list.appendChild(card);
    });
    const add = addButton(collapsed);
    if (add) list.appendChild(add);
    container.appendChild(list);
    // With six accounts the list scrolls; keep the one you switched to (Ctrl+N, a close) on screen.
    list.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'nearest' });

    const footer = el('div', 'acct-dock-footer');
    footer.appendChild(el('span', undefined, `${SHORTCUT.switchAll} to switch`));
    footer.appendChild(el('span', undefined, `${SHORTCUT.collapse} to collapse`));
    container.appendChild(footer);
}

function renderMultiboxControls() {
    const count = document.getElementById('multiboxCount');
    if (count) count.textContent = `${state.accounts.length} / ${state.max}`;
    if (multiboxAdd) multiboxAdd.style.display = state.accounts.length >= state.max ? 'none' : '';
}

function render() {
    if (reordering) {
        renderPending = true;
        return;
    }
    renderPending = false;
    // The strip in use keeps its scrolling chip row (renderStrip refills it); everything else is rebuilt whole.
    if (config.layout !== 'top') stripTop.replaceChildren();
    if (config.layout !== 'bottom') stripBottom.replaceChildren();
    dockLeft.replaceChildren();
    dockRight.replaceChildren();
    switch (config.layout) {
        case 'top': renderStrip(stripTop); break;
        case 'bottom': renderStrip(stripBottom); break;
        case 'left': renderDock(dockLeft); break;
        case 'right': renderDock(dockRight); break;
        case 'multibox': break; // every account is on screen; nothing to list
    }
    renderMultiboxControls();
    const active = state.accounts.find(a => a.active);
    document.title = active && active.name ? `Highspell+ - ${active.name}` : 'Highspell+';
}

// Update a single thumbnail in place so the dock does not re-render every second.
function updatePreviewImage(slot: number) {
    // Main stops capturing when previews are off; this catches a frame that was already in flight.
    if (!config.previews) return;
    const src = previews.get(slot);
    if (!src) return; // never set src = '': Chromium would fetch the page URL itself
    const card = document.querySelector<HTMLElement>(`.acct-card[data-slot="${slot}"]`);
    if (!card) return;
    const thumb = card.querySelector('.acct-thumb');
    if (!thumb) return;
    let img = thumb.querySelector('img');
    if (!img) {
        thumb.querySelector('span:not(.acct-main)')?.remove();
        img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        thumb.prepend(img);
    }
    img.src = src;
}

// ---- main-process events ----------------------------------------------------------------------

window.shell.onState((s) => {
    const previousActive = state.activeSlot;
    state = s;
    for (const slot of [...previews.keys()]) {
        if (!s.accounts.some(a => a.slot === slot)) previews.delete(slot);
    }
    if (s.activeSlot !== previousActive) previews.delete(s.activeSlot);
    render();
});

window.shell.onPreview(({ slot, dataUrl }) => {
    // A capture started before a switch can land after it; a stale frame under the MAIN badge
    // would look like the live view, so the active account never gets a thumbnail.
    if (slot === state.activeSlot) return;
    previews.set(slot, dataUrl);
    if (isDock()) updatePreviewImage(slot);
});

window.shell.onToggleCollapsed(toggleCollapsed);

window.shell.onSettingsChanged(async () => {
    const next = await window.shell.getConfig();
    config = next;
    applyLayout();
    render();
});

// ---- boot -------------------------------------------------------------------------------------

(async () => {
    config = await window.shell.getConfig();
    collapsed = config.startCollapsed; // applyLayout() ignores this for tab layouts
    applyLayout();
    render();
    window.shell.ready();
})();
