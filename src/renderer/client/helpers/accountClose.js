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

// In the multi-account shell every account is its own view, and in the Multibox layout there
// is no tab to close it from. This adds a close (×) button at the top of the Highspell+ plugin
// rail, above the Plugin Hub icon, that asks the shell to close THIS account (same confirmation
// as closing a tab). Falls back to a small floating button if plugins (and so the rail) are off.

const BUTTON_ID = 'hsplus-close-account';

// Closing the only account would close the whole window; the button exists only with 2+.
let accountCount = 1;

function updateVisibility() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.style.display = accountCount > 1 ? '' : 'none';
}

function makeButton() {
    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'highlite_bar_item hsplus-close-account';
    btn.title = 'Close this account (Ctrl+Shift+W)';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Close this account');
    btn.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.account.requestClose();
    });
    btn.style.display = accountCount > 1 ? '' : 'none';
    return btn;
}

function place() {
    if (document.getElementById(BUTTON_ID)) return true;
    const bar = document.querySelector('.highlite_bar');
    if (bar) {
        bar.prepend(makeButton());
        return true;
    }
    return false;
}

export function initAccountClose() {
    if (!window.account || !window.account.embedded) return;
    window.account.onAccountCount((n) => {
        accountCount = n;
        updateVisibility();
    });
    if (place()) return;

    // The plugin rail is built by core after the game boots; wait for it, then give up on it
    // and float the button if plugins are disabled.
    const observer = new MutationObserver(() => {
        if (place()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
        if (document.getElementById(BUTTON_ID)) return;
        observer.disconnect();
        const btn = makeButton();
        btn.classList.add('hsplus-close-account--floating');
        document.body.appendChild(btn);
    }, 15000);
}
