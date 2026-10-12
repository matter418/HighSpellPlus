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
// as closing a tab). With plugins (and so the rail) off, the caller asks for a floating button.

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
    return btn;
}

/**
 * @param {{ floating?: boolean }} [opts] `floating`: there is no plugin rail (plugins off), so
 * pin the button to the view's top-right corner instead. Core builds `.highlite_bar` in the
 * `Highlite` constructor, so with plugins on it already exists when this runs.
 */
export function initAccountClose({ floating = false } = {}) {
    if (!window.account?.embedded) return;
    if (document.getElementById(BUTTON_ID)) return;
    window.account.onAccountCount((n) => {
        accountCount = n;
        updateVisibility();
    });
    const bar = floating ? null : document.querySelector('.highlite_bar');
    const btn = makeButton();
    if (bar) {
        bar.prepend(btn);
    } else {
        btn.classList.add('hsplus-close-account--floating');
        document.body.appendChild(btn);
    }
    updateVisibility();
}
