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

// Inside the multi-account shell the window chrome belongs to shell.html, so this page drops
// its own title bar and forwards its warning state to the shell instead of drawing it.
const embedded = Boolean(window.account?.embedded);
if (embedded) {
    const bar = document.querySelector('.highlite_titlebar');
    if (bar) bar.remove();
    // index.css sets --titlebar-height: 28px on :root, and plugins (Nameplates, Entity
    // Highlighter) size their canvas overlays as `top: var(--titlebar-height); height: calc(100%
    // - var(--titlebar-height))`. With the bar gone the game canvas starts at y=0, so the
    // variable must follow or every overlay sits 28px low (ground-item plates drawn over the item
    // instead of above it) and `overflow: hidden` clips plates near the top of the view.
    document.documentElement.style.setProperty('--titlebar-height', '0px');
}

const warningIndicator = document.querySelector('#warningIndicator');
const warningIcon = document.querySelector('#warningIndicator .warning-icon');

// Highest level shown since the indicator was last cleared. The game logs warnings every few
// seconds, so the shell is only told when the level actually goes up (none → warning → error).
const LEVEL_RANK = { none: 0, warning: 1, error: 2 };
let shownLevel = 'none';

function clearWarning() {
    shownLevel = 'none';
    if (!warningIndicator || !warningIcon) return;
    warningIcon.classList.remove('warning', 'error');
    warningIndicator.style.display = 'none';
}

function flagWarning(level) {
    if (LEVEL_RANK[level] <= LEVEL_RANK[shownLevel]) return;
    shownLevel = level;
    if (embedded) {
        window.account.notifyWarning(level);
        return;
    }
    if (!warningIndicator || !warningIcon) return;
    // Errors take precedence over warnings
    warningIcon.classList.toggle('error', level === 'error');
    warningIcon.classList.toggle('warning', level !== 'error');
    warningIndicator.style.display = 'flex';
}

// On click open the console and clear the indicator
if (warningIndicator) {
    warningIndicator.onclick = () => {
        window.electron.ipcRenderer.send('show-console');
        clearWarning();
    };
}
// Embedded: the indicator lives in the shell, which tells us when the user cleared it.
if (embedded) {
    window.electron.ipcRenderer.on('account:warning-cleared', clearWarning);
}

const ogError = console.error;
console.error = function (...args) {
    ogError(...args);
    flagWarning('error');
};

const ogWarn = console.warn;
console.warn = function (...args) {
    ogWarn(...args);
    flagWarning('warning');
};

// Obtain references to the minimize, maximize, and close buttons (absent when embedded)
const minimizeButton = document.querySelector('#minimizeBtn');
const maximizeButton = document.querySelector('#maximizeBtn');
const closeButton = document.querySelector('#closeBtn');
const settingsButton = document.querySelector('#settingsBtn');
const screenshotButton = document.querySelector('#screenshotBtn');

// Add click event listeners to the buttons
if (minimizeButton) {
    minimizeButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('minimize-window');
    });
}
if (maximizeButton) {
    maximizeButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('toggle-maximize-window');
    });
}
if (closeButton) {
    closeButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('close-window');
    });
}
if (settingsButton) {
    settingsButton.addEventListener('click', () => {
        window.electron.ipcRenderer.send('settings:open');
    });
}

// Screenshot capture button
if (screenshotButton) {
    screenshotButton.addEventListener('click', async () => {
        const res = await window.screenshot.capture();
        if (!res.ok) {
            console.error('Screenshot failed:', res.error);
        }
    });
}

const isDarwin = window.electron.process.platform === 'darwin';

// Hide the window controls if the OS is Darwin (macOS)
if (isDarwin) {
    const controls = document.getElementById('window-controls');
    if (controls) controls.remove();
} else {
    const spacer = document.getElementById('darwin-spacer');
    if (spacer) spacer.remove();
}

export function setTitle(title) {
    // document.title is also how the multi-account shell learns the account name.
    document.title = title;
    const logoText = document.getElementById('logoText');
    if (logoText) {
        logoText.textContent = title;
    }
}

// "Highspell+ - <name>" is the one title format the shell (main) and uiLayout.js parse the
// character name back out of; keep both halves of it here so they cannot drift apart.
export function setAccountTitle(name) {
    setTitle(`Highspell+ - ${name}`);
}

/** Character name from an account title; '' for anything else (e.g. the login screen). */
export function accountNameFromTitle(title) {
    const m = /^Highspell\+\s*-\s*(.+)$/.exec(title || '');
    return m ? m[1].trim() : '';
}
