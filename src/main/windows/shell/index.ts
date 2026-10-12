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

// Multi-account shell window.
//
// One BrowserWindow whose own page (shell.html) draws the title bar and the account
// strip/dock, plus one WebContentsView per account that loads the normal client.html
// loader. Only the active view is visible; the others keep running (backgroundThrottling
// off + the client's frame throttle) so their sessions stay logged in.
//
// Slot 1 uses the default session so an existing single-account install keeps its cached
// client, hooks and plugin settings. Slots 2–6 get their own persistent partition so
// cookies, localStorage and IndexedDB never collide between accounts.

import {
    app,
    BrowserWindow,
    WebContentsView,
    ipcMain,
    session,
    shell as electronShell,
    dialog,
    Rectangle,
    Session,
    WebContents,
} from 'electron';
import path from 'path';
import { format } from 'url';
import log from 'electron-log';
import { settingsService } from '../../modules/settingsManagement';
import { registerWebContents } from '../../modules/windowRegistry';

export const MAX_ACCOUNTS = 6;

export type AccountState = 'loading' | 'login' | 'ingame' | 'crashed';

interface Account {
    slot: number;
    view: WebContentsView;
    /** webContents.id, cached: reading view.webContents after the view is destroyed throws. */
    wcId: number;
    name: string;
    state: AccountState;
    attention: string | null;
    previewBusy: boolean;
}

export interface ShellConfig {
    layout: 'top' | 'bottom' | 'left' | 'right' | 'multibox';
    previews: boolean;
    startCollapsed: boolean;
    /** Hidden-view render rate and dock thumbnail refresh rate. */
    fps: number;
    isolateSessions: boolean;
    /** #rrggbb used for the idle flash on tabs and dock cards. */
    attentionColor: string;
    max: number;
}

const PREVIEW_WIDTH = 240;
const PREVIEW_JPEG_QUALITY = 70;

const preloadPath = path.join(__dirname, '../preload/index.js');
const preparedSessions = new WeakSet<Session>();

function clientUrl(): string {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        return `${process.env['ELECTRON_RENDERER_URL']}/client.html`;
    }
    return format({
        protocol: 'file',
        slashes: true,
        pathname: path.join(__dirname, '../renderer/client.html'),
    });
}

function shellUrl(): string {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        return `${process.env['ELECTRON_RENDERER_URL']}/shell.html`;
    }
    return format({
        protocol: 'file',
        slashes: true,
        pathname: path.join(__dirname, '../renderer/shell.html'),
    });
}

/** Per-session request rewriting, mirrored from the single-account window. */
function prepareSession(ses: Session) {
    if (preparedSessions.has(ses)) return;
    preparedSessions.add(ses);

    if (ses !== session.defaultSession) {
        // Legacy plugins still call highlite.dev; the default session gets this in windows/client.
        ses.webRequest.onBeforeRequest({ urls: ['*://highlite.dev/*'] }, (details, callback) => {
            callback({ redirectURL: details.url.replace('highlite.dev', 'ryelite.org') });
        });
    }

    if (!app.isPackaged) {
        ses.webRequest.onBeforeSendHeaders((details, callback) => {
            if (details.url.includes('highspell.com')) {
                details.requestHeaders['Origin'] = 'https://highspell.com';
                details.requestHeaders['Referer'] = 'https://highspell.com/';
            }
            callback({ requestHeaders: details.requestHeaders });
        });
    }
}

function accountNameFromTitle(title: string): string {
    // userHelper sets "Highspell+ - <username>" once a saved login is picked or Login is clicked.
    const m = /^Highspell\+\s*-\s*(.+)$/.exec(title || '');
    return m ? m[1].trim() : '';
}

function readConfig(): ShellConfig {
    const layout = String(settingsService.get('MultiAccount', 'Account Bar Position') ?? 'top');
    const fps = Number(settingsService.get('MultiAccount', 'Background Frame Rate'));
    const color = String(settingsService.get('MultiAccount', 'Idle Alert Color') ?? '');
    return {
        attentionColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#f9f449',
        layout: (['top', 'bottom', 'left', 'right', 'multibox'].includes(layout) ? layout : 'top') as ShellConfig['layout'],
        previews: settingsService.get('MultiAccount', 'Live Previews') !== false,
        startCollapsed: settingsService.get('MultiAccount', 'Start Collapsed') === true,
        fps: Number.isFinite(fps) && fps > 0 ? Math.min(60, fps) : 15,
        isolateSessions: settingsService.get('MultiAccount', 'Isolate Account Sessions') === true,
        max: MAX_ACCOUNTS,
    };
}

/**
 * Multibox grid: how `n` accounts (in slot order) share the content area.
 * 1 full · 2 side by side · 3 one tall left + two stacked right · 4 quadrants ·
 * 5 one tall third + four in the other two thirds · 6 three columns by two rows.
 */
function multiboxRects(n: number, b: Rectangle): Rectangle[] {
    const r = (x: number, y: number, w: number, h: number): Rectangle => ({
        x: Math.round(b.x + x * b.width), y: Math.round(b.y + y * b.height),
        width: Math.max(1, Math.round(w * b.width)), height: Math.max(1, Math.round(h * b.height)),
    });
    switch (Math.min(6, Math.max(1, n))) {
        case 1: return [r(0, 0, 1, 1)];
        case 2: return [r(0, 0, 0.5, 1), r(0.5, 0, 0.5, 1)];
        case 3: return [r(0, 0, 0.5, 1), r(0.5, 0, 0.5, 0.5), r(0.5, 0.5, 0.5, 0.5)];
        case 4: return [r(0, 0, 0.5, 0.5), r(0.5, 0, 0.5, 0.5), r(0, 0.5, 0.5, 0.5), r(0.5, 0.5, 0.5, 0.5)];
        case 5: return [
            r(0, 0, 1 / 3, 1),
            r(1 / 3, 0, 1 / 3, 0.5), r(2 / 3, 0, 1 / 3, 0.5),
            r(1 / 3, 0.5, 1 / 3, 0.5), r(2 / 3, 0.5, 1 / 3, 0.5),
        ];
        default: return [
            r(0, 0, 1 / 3, 0.5), r(1 / 3, 0, 1 / 3, 0.5), r(2 / 3, 0, 1 / 3, 0.5),
            r(0, 0.5, 1 / 3, 0.5), r(1 / 3, 0.5, 1 / 3, 0.5), r(2 / 3, 0.5, 1 / 3, 0.5),
        ];
    }
}

export function isMultiAccountEnabled(): boolean {
    return settingsService.get('MultiAccount', 'Enable Multiple Accounts') === true;
}

class ShellWindow {
    readonly win: BrowserWindow;
    private accounts: Account[] = [];
    private activeSlot = 0;
    private contentBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
    private previewTimer: NodeJS.Timeout | null = null;
    private previewFps = 0;
    private shellReady = false;
    private readonly shellWcId: number;
    // Decided once per window: switching mid-run would split accounts across profiles.
    private readonly isolateSessions = readConfig().isolateSessions;

    constructor() {
        this.win = new BrowserWindow({
            webPreferences: {
                preload: preloadPath,
                sandbox: false,
                contextIsolation: true,
                nodeIntegration: false,
                webSecurity: app.isPackaged,
            },
            minHeight: 500,
            minWidth: 500,
            icon: path.join(__dirname, 'icons/icon.png'),
            titleBarStyle: 'hidden',
            backgroundColor: '#141414',
            show: true,
        });
        this.win.setMenu(null);
        this.shellWcId = this.win.webContents.id;
        shells.set(this.shellWcId, this);
        registerWebContents(this.win.webContents, this.win, () => this.activeWebContents());

        this.win.webContents.setWindowOpenHandler(({ url }) => {
            electronShell.openExternal(url);
            return { action: 'deny' };
        });
        this.win.webContents.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown') return;
            if (input.key === 'F12') {
                event.preventDefault();
                this.win.webContents.toggleDevTools();
                return;
            }
            this.handleShortcut(event, input);
        });
        this.win.on('ready-to-show', () => this.win.webContents.setZoomLevel(0));

        this.win.on('close', (event) => {
            const loggedIn = this.accounts.filter(a => a.state === 'ingame').length;
            if (loggedIn === 0) return;
            const choice = dialog.showMessageBoxSync(this.win, {
                type: 'question',
                buttons: ['Close', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                title: 'Close Highspell+',
                message: `${loggedIn} account${loggedIn === 1 ? ' is' : 's are'} still logged in.`,
                detail: 'Closing the window will log out every account in it.',
            });
            if (choice !== 0) event.preventDefault();
        });
        this.win.on('closed', () => this.destroy());

        // settingsManagement emits this internal event after any save; the layout may have
        // switched between multibox and a tab/dock layout, which changes every view's bounds.
        const onSettings = () => { if (!this.win.isDestroyed()) this.applyBounds(); };
        ipcMain.on('settings:changed', onSettings);
        this.win.once('closed', () => ipcMain.removeListener('settings:changed', onSettings));

        this.win.loadURL(shellUrl());

        // First account is opened straight away so the window is never empty.
        this.addAccount();
    }

    // ---- accounts -------------------------------------------------------------------------

    private freeSlot(): number {
        for (let s = 1; s <= MAX_ACCOUNTS; s++) {
            if (!this.accounts.some(a => a.slot === s)) return s;
        }
        return 0;
    }

    addAccount(): Account | null {
        const slot = this.freeSlot();
        if (!slot) return null;

        // All accounts share the default profile unless isolation is on (the mobile client's
        // six tabs share one WebView profile and that is device-verified fine). Sharing means
        // installed plugins, the cached client and the hook map carry over to every tab.
        const ses = slot === 1 || !this.isolateSessions
            ? session.defaultSession
            : session.fromPartition(`persist:acct-${slot}`);
        prepareSession(ses);

        const view = new WebContentsView({
            webPreferences: {
                preload: preloadPath,
                sandbox: false,
                contextIsolation: true,
                nodeIntegration: false,
                nodeIntegrationInSubFrames: false,
                nodeIntegrationInWorker: false,
                webSecurity: app.isPackaged,
                session: ses,
                backgroundThrottling: false,
                additionalArguments: [`--hsplus-slot=${slot}`],
            },
        });
        view.setBackgroundColor('#000000');

        const wc = view.webContents;
        const account: Account = { slot, view, wcId: wc.id, name: '', state: 'loading', attention: null, previewBusy: false };
        this.accounts.push(account);
        this.accounts.sort((a, b) => a.slot - b.slot);

        shells.set(wc.id, this);
        registerWebContents(wc, this.win, () => this.activeWebContents());

        if (!app.isPackaged) {
            wc.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );
        }
        wc.setWindowOpenHandler(({ url }) => {
            electronShell.openExternal(url);
            return { action: 'deny' };
        });
        wc.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown') return;
            if (input.key === 'F12') {
                event.preventDefault();
                wc.toggleDevTools();
                return;
            }
            this.handleShortcut(event, input);
        });
        wc.on('zoom-changed', (_event, zoomDirection) => {
            const delta = zoomDirection === 'in' ? 0.1 : -0.1;
            wc.setZoomLevel(wc.getZoomLevel() + delta);
        });
        wc.on('console-message', (event) => {
            ipcMain.emit('add-console-message', {
                level: event.level,
                text: event.message,
                lineNumber: event.lineNumber,
                source: event.sourceId,
                slot,
            });
        });
        wc.on('page-title-updated', (_event, title) => {
            account.name = accountNameFromTitle(title);
            this.broadcastState();
        });
        wc.once('did-finish-load', () => {
            if (account.state === 'loading') account.state = 'login';
            wc.setZoomLevel(0);
            // Keyboard focus given before the page existed does not survive the load; a newly
            // added account would otherwise show a caret-less login form until the user clicks
            // a tab. Re-focus now that there is a document to receive it.
            if (account.slot === this.activeSlot) this.focusActive();
            wc.send('account:count', this.accounts.length);
            this.broadcastState();
        });
        wc.on('focus', () => {
            // In multibox every view is visible and a click moves focus; track it so Ctrl+Shift+W
            // and the idle-alert "active" logic follow the account the user is actually in.
            if (this.activeSlot !== slot && this.accounts.some(a => a.slot === slot)) {
                this.activeSlot = slot;
                const acct = this.accounts.find(a => a.slot === slot);
                if (acct) acct.attention = null;
                this.broadcastState();
            }
        });
        wc.on('render-process-gone', (_event, details) => {
            log.error(`Account ${slot} renderer gone: ${details.reason}`);
            account.state = 'crashed';
            this.broadcastState();
        });

        this.win.contentView.addChildView(view);
        wc.loadURL(clientUrl());

        this.activate(slot);
        this.syncPreviewTimer();
        return account;
    }

    private isMultibox(): boolean {
        return readConfig().layout === 'multibox';
    }

    activate(slot: number) {
        const target = this.accounts.find(a => a.slot === slot);
        if (!target) return;
        this.activeSlot = slot;
        target.attention = null; // looking at it answers the alert
        this.applyBounds();
        this.focusActive();
        this.broadcastState();
    }

    /** Position and show/hide every view for the current layout (tabs/dock = one visible, multibox = grid). */
    private applyBounds() {
        const multibox = this.isMultibox();
        const rects = multibox ? multiboxRects(this.accounts.length, this.contentBounds) : null;
        this.accounts.forEach((a, i) => {
            const visible = multibox || a.slot === this.activeSlot;
            a.view.setBounds(rects ? rects[i] : this.contentBounds);
            a.view.setVisible(visible);
            if (!a.view.webContents.isDestroyed()) {
                a.view.webContents.send('account:visibility', visible);
            }
        });
    }

    /**
     * Move keyboard focus into the active account's view. A hidden WebContentsView can keep
     * keyboard focus after setVisible(false), and the shell page holds it after a tab click, so
     * focus is handed over explicitly on every switch (and again a tick later, once the
     * visibility change has been applied by the compositor).
     */
    private focusActive() {
        const wc = this.activeWebContents();
        if (!wc) return;
        wc.focus();
        setTimeout(() => {
            if (!wc.isDestroyed() && this.activeWebContents() === wc && this.win.isFocused()) wc.focus();
        }, 50);
    }

    async closeAccount(slot: number, confirm = true) {
        const account = this.accounts.find(a => a.slot === slot);
        if (!account) return;

        if (confirm && account.state === 'ingame') {
            const { response } = await dialog.showMessageBox(this.win, {
                type: 'question',
                buttons: ['Log out and close', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                title: 'Close account',
                message: `${account.name || `Account ${slot}`} is logged in.`,
                detail: 'Closing this tab disconnects it from the game.',
            });
            if (response !== 0) return;
        }

        this.accounts = this.accounts.filter(a => a.slot !== slot);
        shells.delete(account.wcId);
        try {
            this.win.contentView.removeChildView(account.view);
            if (!account.view.webContents.isDestroyed()) account.view.webContents.close();
        } catch (e) {
            log.warn(`Failed to tear down account ${slot}:`, e);
        }

        if (this.accounts.length === 0) {
            this.win.close();
            return;
        }
        if (this.activeSlot === slot) {
            // Prefer the neighbour to the left, like a browser tab strip.
            const left = [...this.accounts].reverse().find(a => a.slot < slot);
            this.activate((left ?? this.accounts[0]).slot);
        } else {
            this.applyBounds(); // multibox grid reflows when any account leaves
            this.broadcastState();
        }
        this.syncPreviewTimer();
    }

    /** Close the account that owns `wc` (the in-view × button). */
    closeAccountOf(wc: WebContents) {
        const account = this.accounts.find(a => a.wcId === wc.id);
        if (account) void this.closeAccount(account.slot);
    }

    setAccountState(wc: WebContents, state: AccountState) {
        const account = this.accounts.find(a => a.wcId === wc.id);
        if (!account) return;
        account.state = state;
        this.broadcastState();
    }

    setAttention(wc: WebContents, kind: string | null) {
        const account = this.accounts.find(a => a.wcId === wc.id);
        if (!account) return;
        // The account you are looking at never needs to flash.
        const next = kind && account.slot !== this.activeSlot ? kind : null;
        if (next === account.attention) return;
        account.attention = next;
        this.broadcastState();
    }

    forwardWarning(wc: WebContents, level: string) {
        const account = this.accounts.find(a => a.wcId === wc.id);
        if (!account) return;
        this.sendToShell('shell:warning', { slot: account.slot, level });
    }

    activeWebContents(): WebContents | null {
        const a = this.accounts.find(x => x.slot === this.activeSlot);
        if (!a) return null;
        try {
            return a.view.webContents.isDestroyed() ? null : a.view.webContents;
        } catch {
            return null; // view already torn down with the window
        }
    }

    // ---- layout ---------------------------------------------------------------------------

    setContentBounds(b: Rectangle) {
        this.contentBounds = {
            x: Math.max(0, Math.round(b.x)),
            y: Math.max(0, Math.round(b.y)),
            width: Math.max(1, Math.round(b.width)),
            height: Math.max(1, Math.round(b.height)),
        };
        this.applyBounds();
    }

    private handleShortcut(event: Electron.Event, input: Electron.Input) {
        if (!input.control || input.alt || input.meta) return;
        if (/^[1-6]$/.test(input.key)) {
            event.preventDefault();
            this.activate(Number(input.key));
        } else if (input.key === '`' && !input.shift) {
            event.preventDefault();
            this.sendToShell('shell:toggle-collapsed');
        } else if (input.key.toLowerCase() === 't' && input.shift) {
            event.preventDefault();
            this.addAccount();
        } else if (input.key.toLowerCase() === 'w' && input.shift) {
            event.preventDefault();
            void this.closeAccount(this.activeSlot);
        }
    }

    // ---- shell page messaging ---------------------------------------------------------------

    markShellReady() {
        this.shellReady = true;
        this.broadcastState();
    }

    private sendToShell(channel: string, payload?: unknown) {
        if (this.win.isDestroyed()) return;
        this.win.webContents.send(channel, payload);
    }

    broadcastState() {
        // Every view learns the account count (the in-view × hides itself when it is the last one).
        for (const a of this.accounts) {
            try {
                if (!a.view.webContents.isDestroyed()) a.view.webContents.send('account:count', this.accounts.length);
            } catch { /* torn down */ }
        }
        if (!this.shellReady) return;
        this.sendToShell('shell:state', {
            activeSlot: this.activeSlot,
            max: MAX_ACCOUNTS,
            accounts: this.accounts.map(a => ({
                slot: a.slot,
                name: a.name,
                state: a.state,
                active: a.slot === this.activeSlot,
                attention: a.attention,
            })),
        });
    }

    // ---- previews ---------------------------------------------------------------------------

    /** (Re)arm the thumbnail timer at the configured frame rate; called on add/close and on each tick. */
    private syncPreviewTimer() {
        const want = this.accounts.length > 1;
        const fps = readConfig().fps;
        if (want && (!this.previewTimer || fps !== this.previewFps)) {
            if (this.previewTimer) clearInterval(this.previewTimer);
            this.previewFps = fps;
            this.previewTimer = setInterval(() => this.capturePreviews(), Math.round(1000 / fps));
        } else if (!want && this.previewTimer) {
            clearInterval(this.previewTimer);
            this.previewTimer = null;
            this.previewFps = 0;
        }
    }

    private capturePreviews() {
        const cfg = readConfig();
        if (cfg.fps !== this.previewFps) this.syncPreviewTimer();
        // Thumbnails are only shown in the dock layouts (a popover over the game area would be
        // drawn underneath the active view), so don't pay for captures in the tab or multibox layouts.
        const wantsThumbs = cfg.previews && (cfg.layout === 'left' || cfg.layout === 'right');
        if (!wantsThumbs || this.win.isDestroyed()) return;
        for (const a of this.accounts) {
            if (a.slot === this.activeSlot || a.previewBusy || a.state === 'crashed') continue;
            let wc: WebContents;
            try {
                wc = a.view.webContents;
            } catch {
                continue;
            }
            if (wc.isDestroyed()) continue;
            a.previewBusy = true;
            wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
                .then(img => {
                    if (img.isEmpty()) return;
                    // JPEG: an order of magnitude cheaper to encode than PNG at 15–60 captures/s.
                    const small = img.resize({ width: PREVIEW_WIDTH, quality: 'good' });
                    const dataUrl = 'data:image/jpeg;base64,' + small.toJPEG(PREVIEW_JPEG_QUALITY).toString('base64');
                    this.sendToShell('shell:preview', { slot: a.slot, dataUrl });
                })
                .catch(() => { /* view may be mid-navigation; try again next tick */ })
                .finally(() => { a.previewBusy = false; });
        }
    }

    // ---- teardown ---------------------------------------------------------------------------

    /** 'closed' handler: by now the window and its child views' webContents are already gone,
     *  so this only drops bookkeeping; every Electron object access is guarded. */
    private destroy() {
        if (this.previewTimer) clearInterval(this.previewTimer);
        this.previewTimer = null;
        for (const a of this.accounts) {
            shells.delete(a.wcId);
            try {
                if (!a.view.webContents.isDestroyed()) a.view.webContents.close();
            } catch { /* already gone */ }
        }
        this.accounts = [];
        shells.delete(this.shellWcId);
        if (currentShell === this) currentShell = null;
    }
}

// webContents id (shell page or any account view) -> owning ShellWindow
const shells = new Map<number, ShellWindow>();
let currentShell: ShellWindow | null = null;
let ipcRegistered = false;

function shellFor(sender: WebContents): ShellWindow | undefined {
    return shells.get(sender.id);
}

function registerShellIPC() {
    if (ipcRegistered) return;
    ipcRegistered = true;

    ipcMain.handle('shell:get-config', () => readConfig());
    ipcMain.on('shell:ready', (event) => shellFor(event.sender)?.markShellReady());
    ipcMain.on('shell:content-bounds', (event, bounds: Rectangle) => shellFor(event.sender)?.setContentBounds(bounds));
    ipcMain.on('shell:activate', (event, slot: number) => shellFor(event.sender)?.activate(Number(slot)));
    ipcMain.on('shell:add', (event) => shellFor(event.sender)?.addAccount());
    ipcMain.on('shell:close', (event, slot: number) => { void shellFor(event.sender)?.closeAccount(Number(slot)); });

    ipcMain.on('account:state', (event, state: AccountState) => shellFor(event.sender)?.setAccountState(event.sender, state));
    ipcMain.on('account:warning', (event, level: string) => shellFor(event.sender)?.forwardWarning(event.sender, level));
    ipcMain.on('account:attention', (event, kind: string | null) => shellFor(event.sender)?.setAttention(event.sender, kind));
    ipcMain.on('account:close', (event) => shellFor(event.sender)?.closeAccountOf(event.sender));
}

export function getShellWindow(): BrowserWindow | null {
    return currentShell && !currentShell.win.isDestroyed() ? currentShell.win : null;
}

/** Second launch / macOS activate while a shell exists: open another account in it. */
export function addAccountToShell(): boolean {
    if (!currentShell || currentShell.win.isDestroyed()) return false;
    currentShell.addAccount();
    if (currentShell.win.isMinimized()) currentShell.win.restore();
    currentShell.win.focus();
    return true;
}

export async function createShellWindow(): Promise<BrowserWindow> {
    registerShellIPC();
    const existing = getShellWindow();
    if (existing) {
        addAccountToShell();
        return existing;
    }
    currentShell = new ShellWindow();
    return currentShell.win;
}
