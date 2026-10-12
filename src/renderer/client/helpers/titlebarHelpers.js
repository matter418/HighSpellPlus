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
const embedded = Boolean(window.account && window.account.embedded);
if (embedded) {
    const bar = document.querySelector('.highlite_titlebar');
    if (bar) bar.remove();
}

function flagWarning(level) {
    if (embedded) {
        window.account.notifyWarning(level);
        return;
    }
    const warningIndicator = document.querySelector('#warningIndicator');
    const warningIcon = document.querySelector('#warningIndicator .warning-icon');
    if (!warningIndicator || !warningIcon) return;

    if (level === 'error') {
        // Errors take precedence over warnings
        warningIcon.classList.remove('warning');
        warningIcon.classList.add('error');
    } else if (!warningIcon.classList.contains('error')) {
        warningIcon.classList.add('warning');
    }
    warningIndicator.style.display = 'flex';

    // On click open the console and clear the indicator
    warningIndicator.onclick = () => {
        window.electron.ipcRenderer.send('show-console');
        warningIcon.classList.remove('warning', 'error');
        warningIndicator.style.display = 'none';
    };
}

let ogError = console.error;
console.error = function (...args) {
    ogError(...args);
    flagWarning('error');
};

let ogWarn = console.warn;
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
