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

import '@iconify/iconify';

type Layout = 'top' | 'bottom' | 'left' | 'right';
type AccountState = 'loading' | 'login' | 'ingame' | 'crashed';

interface AccountInfo {
    slot: number;
    name: string;
    state: AccountState;
    active: boolean;
    attention: string | null;
}

interface ShellState {
    activeSlot: number;
    max: number;
    accounts: AccountInfo[];
}

interface ShellConfig {
    layout: Layout;
    previews: boolean;
    startCollapsed: boolean;
    attentionColor: string;
    max: number;
}

const STATE_LABEL: Record<AccountState, string> = {
    loading: 'Loading…',
    login: 'Login screen',
    ingame: 'In game',
    crashed: 'Crashed',
};

let config: ShellConfig = { layout: 'top', previews: true, startCollapsed: false, attentionColor: '#f9f449', max: 6 };
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
document.getElementById('collapseBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleCollapsed();
});

const warningIndicator = document.getElementById('warningIndicator')!;
const warningIcon = warningIndicator.querySelector('.warning-icon')!;
warningIndicator.addEventListener('click', (e) => {
    e.preventDefault();
    window.electron.ipcRenderer.send('show-console');
    warningIcon.classList.remove('warning', 'error');
    warningIndicator.style.display = 'none';
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
}
new ResizeObserver(pushContentBounds).observe(content);
window.addEventListener('resize', pushContentBounds);

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
    const collapseBtn = document.getElementById('collapseBtn');
    if (collapseBtn) {
        const vertical = config.layout === 'top' || config.layout === 'bottom';
        const label = `${collapsed ? 'Show' : 'Hide'} account ${vertical ? 'bar' : 'dock'} (Ctrl+\`)`;
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

// ---- rendering -------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function displayName(a: AccountInfo): string {
    return a.name || `Account ${a.slot}`;
}

function dot(a: AccountInfo): HTMLElement {
    return el('span', `acct-dot state-${a.state}`);
}

function closeButton(a: AccountInfo): HTMLButtonElement {
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

function selectButton(a: AccountInfo, children: HTMLElement[]): HTMLButtonElement {
    const b = el('button', 'acct-select');
    b.type = 'button';
    b.title = `${displayName(a)} — ${a.attention === 'idle' ? 'IDLE' : STATE_LABEL[a.state]} (Ctrl+${a.slot})`;
    b.setAttribute('aria-label', `Switch to ${displayName(a)}`);
    for (const c of children) b.appendChild(c);
    b.addEventListener('click', () => window.shell.activate(a.slot));
    return b;
}

function addButton(compact: boolean): HTMLButtonElement | null {
    if (state.accounts.length >= state.max) return null;
    const b = el('button', 'acct-add');
    b.type = 'button';
    b.title = 'Add account (Ctrl+Shift+T)';
    b.setAttribute('aria-label', 'Add account');
    b.textContent = compact ? '+' : '+ Add account';
    b.addEventListener('click', () => window.shell.add());
    return b;
}

function collapseButton(): HTMLButtonElement {
    const b = el('button', 'acct-dock-collapse');
    b.type = 'button';
    b.title = `${collapsed ? 'Expand' : 'Collapse'} dock (Ctrl+\`)`;
    b.setAttribute('aria-label', b.title);
    b.innerHTML = '<svg class="collapse-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
    b.addEventListener('click', toggleCollapsed);
    return b;
}

function countLabel(): HTMLElement {
    return el('span', 'acct-count', `${state.accounts.length} / ${state.max}`);
}

function renderStrip(container: HTMLElement) {
    container.replaceChildren();
    for (const a of state.accounts) {
        const chip = el('div', `acct-chip${a.active ? ' active' : ''}${a.attention ? ' attention' : ''}`);
        chip.dataset.slot = String(a.slot);
        chip.appendChild(selectButton(a, [
            el('span', 'acct-num', String(a.slot)),
            el('span', 'acct-name', displayName(a)),
            dot(a),
        ]));
        chip.appendChild(closeButton(a));
        container.appendChild(chip);
    }
    const add = addButton(true);
    if (add) container.appendChild(add);
    container.appendChild(countLabel());
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
    for (const a of state.accounts) {
        if (collapsed) {
            const b = el('button', `acct-rail-btn${a.active ? ' active' : ''}${a.attention ? ' attention' : ''}`);
            b.type = 'button';
            b.title = `${displayName(a)} — ${STATE_LABEL[a.state]} (Ctrl+${a.slot})`;
            b.setAttribute('aria-label', `Switch to ${displayName(a)}`);
            b.appendChild(el('span', 'acct-num', String(a.slot)));
            b.appendChild(dot(a));
            b.addEventListener('click', () => window.shell.activate(a.slot));
            list.appendChild(b);
            continue;
        }

        const card = el('div', `acct-card${a.active ? ' active' : ''}${a.attention ? ' attention' : ''}`);
        card.dataset.slot = String(a.slot);

        const thumb = el('div', 'acct-thumb');
        const src = previews.get(a.slot);
        if (src && config.previews) {
            const img = el('img');
            img.src = src;
            img.alt = '';
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el('span', undefined, a.active ? 'Showing in main view' : STATE_LABEL[a.state]));
        }
        if (a.active) thumb.appendChild(el('span', 'acct-main', 'MAIN'));

        const meta = el('div', 'acct-meta');
        meta.appendChild(dot(a));
        meta.appendChild(el('span', 'acct-name', displayName(a)));
        meta.appendChild(el('span', 'acct-state', a.attention === 'idle' ? 'Idle!' : STATE_LABEL[a.state]));

        card.appendChild(selectButton(a, [thumb, meta]));
        card.appendChild(closeButton(a));
        list.appendChild(card);
    }
    const add = addButton(collapsed);
    if (add) list.appendChild(add);
    container.appendChild(list);

    const footer = el('div', 'acct-dock-footer');
    footer.appendChild(el('span', undefined, 'Ctrl+1…6 to switch'));
    footer.appendChild(el('span', undefined, 'Ctrl+` to collapse'));
    container.appendChild(footer);
}

function render() {
    stripTop.replaceChildren();
    stripBottom.replaceChildren();
    dockLeft.replaceChildren();
    dockRight.replaceChildren();
    switch (config.layout) {
        case 'top': renderStrip(stripTop); break;
        case 'bottom': renderStrip(stripBottom); break;
        case 'left': renderDock(dockLeft); break;
        case 'right': renderDock(dockRight); break;
    }
    const active = state.accounts.find(a => a.active);
    document.title = active && active.name ? `Highspell+ - ${active.name}` : 'Highspell+';
}

// Update a single thumbnail in place so the dock does not re-render every second.
function updatePreviewImage(slot: number) {
    const card = document.querySelector<HTMLElement>(`.acct-card[data-slot="${slot}"]`);
    if (!card) return;
    const thumb = card.querySelector('.acct-thumb');
    if (!thumb) return;
    let img = thumb.querySelector('img');
    if (!img) {
        thumb.querySelector('span:not(.acct-main)')?.remove();
        img = document.createElement('img');
        img.alt = '';
        thumb.prepend(img);
    }
    img.src = previews.get(slot) || '';
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
    previews.set(slot, dataUrl);
    if (config.layout === 'left' || config.layout === 'right') updatePreviewImage(slot);
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
