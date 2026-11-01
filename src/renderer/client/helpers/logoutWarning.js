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

// Logout warning. A minute before the server logs an inactive character out (about 14 minutes
// into, say, an AFK fight that needs no input) the game posts a system line in chat along the
// lines of "You are about to be logged out in 1 minute". Easy to miss on a background tab or
// another window, so this watches the public chat list for that line and, when it appears,
// plays a sound, shows a banner in the view and, inside the multi-account shell, flags the
// account's tab ("Logging out soon!"). The cue clears when the character does something, when
// the character is gone (logged out), or after a while on its own.
// Needs `document.highlite.gameHooks` for the activity check, so client.ts starts it only when
// plugins are enabled (same as the idle watch).

import { ActionState } from '@ryelite/core';
import { playAlertSound, playAlertSoundRepeating } from '../../shared/alertSounds';

// The game's chat DOM (same ids Chat+ hooks into).
const PUBLIC_LIST_ID = 'hs-public-message-list__container';
const MESSAGE_SELECTOR = '.hs-chat-message-container';
// Lines the game colours as a chat channel carry one of these; a system line carries none. The
// match is limited to system lines so a player typing "logged out in 1 minute" cannot trigger it.
const CHANNEL_CLASSES = ['hs-text--orange', 'hs-text--yellow', 'hs-text--cyan'];
// Wording is matched loosely (the exact server text is not pinned down): something about being
// logged out, with a time or inactivity in the same line.
const LOGOUT_RE = /\blog(?:ged)?\s*out\b/i;
const SOON_RE = /\b(?:\d+|one|a)\s*(?:minute|min|second|sec)|inactiv|idle/i;

// One poll ≈ one game tick (the game loop runs a 600ms TIMESTEP accumulator).
const POLL_MS = 600;
// The warning clears by itself after this long if nothing else cleared it (the logout happens
// about a minute after the message).
const AUTO_CLEAR_MS = 90_000;
const BANNER_ID = 'hsplus-logout-warning';

// Defaults must match the Alerts schema in src/preload/settings.ts (on, Alarm, 60 %, repeat on).
const settings = { enabled: true, sound: 'Alarm', volume: 60, repeat: true };

async function loadSettings() {
    try {
        const [enabled, sound, volume, repeat] = await Promise.all([
            window.settings.get('Alerts', 'Logout Warning'),
            window.settings.get('Alerts', 'Logout Warning Sound'),
            window.settings.get('Alerts', 'Logout Warning Volume (%)'),
            window.settings.get('Alerts', 'Repeat Logout Sound'),
        ]);
        settings.enabled = enabled !== false;
        settings.sound = typeof sound === 'string' ? sound : 'Alarm';
        settings.volume = typeof volume === 'number' && Number.isFinite(volume) ? volume : 60;
        settings.repeat = repeat !== false;
    } catch {
        // keep defaults
    }
}

function banner() {
    let b = document.getElementById(BANNER_ID);
    if (b) return b;
    b = document.createElement('div');
    b.id = BANNER_ID;
    b.setAttribute('role', 'alert');
    b.innerHTML =
        '<span class="hsplus-logout-warning__icon" aria-hidden="true">⚠</span>' +
        '<span class="hsplus-logout-warning__text"></span>';
    document.body.appendChild(b);
    return b;
}

function showBanner(text) {
    banner().querySelector('.hsplus-logout-warning__text').textContent = text;
    document.body.classList.add('hsplus-logout-soon');
}

function hideBanner() {
    document.body.classList.remove('hsplus-logout-soon');
}

function isSystemLine(msg) {
    if (msg.matches('.' + CHANNEL_CLASSES.join(', .'))) return false;
    return !CHANNEL_CLASSES.some(c => msg.querySelector('.' + c));
}

export function initLogoutWarning() {
    void loadSettings();
    window.electron.ipcRenderer.on('settings:changed', () => {
        void loadSettings();
    });

    let warnedAt = 0;
    // State/target seen on the previous poll, so an ongoing AFK fight does not clear its own warning.
    let lastState = ActionState.IdleState;
    let lastTarget = null;
    /** Stops the repeating sound while one is running. */
    let stopSound = null;

    const clear = () => {
        if (warnedAt) {
            warnedAt = 0;
            if (window.account?.embedded) window.account.clearAttention();
        }
        stopSound?.();
        stopSound = null;
        hideBanner();
    };

    const warn = (text) => {
        if (!settings.enabled) {
            console.log('[Highspell+] Logout warning line seen but the warning is off:', text);
            return;
        }
        if (warnedAt) clear(); // the game repeated itself; restart cleanly rather than stacking sounds
        warnedAt = Date.now();
        console.log(`[Highspell+] Logout warning fired (sound ${settings.sound} ${settings.repeat ? 'repeating' : 'once'} at ${settings.volume}%, ` +
            `view ${document.hidden ? 'hidden' : 'visible'}):`, text);
        // Back to back until the player acts (each play starts as the last ends), or once.
        if (settings.repeat) stopSound = playAlertSoundRepeating(settings.sound, settings.volume);
        else playAlertSound(settings.sound, settings.volume);
        if (window.account?.embedded) window.account.notifyAttention('logout');
        showBanner(text || 'You are about to be logged out — do something to stay logged in');
    };

    const onNewMessage = (msg) => {
        const text = (msg.textContent || '').trim();
        const matched = LOGOUT_RE.test(text) && SOON_RE.test(text) && isSystemLine(msg);
        // Diagnostics (forwarded to the main log): any line that mentions logging out, with
        // the verdict, so a wording the matcher misses can be pinned down from the log.
        if (/log/i.test(text) && /out/i.test(text)) {
            console.log(`[Highspell+] Chat line about logging out ${matched ? 'MATCHED' : 'ignored'} ` +
                `(system=${isSystemLine(msg)}, classes="${msg.className}"):`, text);
        }
        if (matched) warn(text);
    };

    // Manual test from the F12 console of any game view: __hsplusLogoutWarningTest() feeds the
    // matcher a fake system line, so the sound/banner/tab flash can be checked without a
    // 14-minute wait (and on a background account).
    window.__hsplusLogoutWarningTest = (text = 'You will be logged out in 1 minute due to inactivity.') => {
        const fake = document.createElement('div');
        fake.className = 'hs-chat-message-container';
        fake.textContent = text;
        onNewMessage(fake);
    };

    // The chat list is created at login and rebuilt on every login, so the observer is
    // (re)attached from the poll below whenever a new list element appears.
    let observedList = null;
    let listObserver = null;
    const observeChat = () => {
        const list = document.getElementById(PUBLIC_LIST_ID);
        if (list === observedList) return;
        listObserver?.disconnect();
        observedList = list;
        if (!list) return;
        console.log('[Highspell+] Logout warning: watching the chat list');
        listObserver = new MutationObserver((records) => {
            for (const rec of records) {
                rec.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;
                    if (node.matches(MESSAGE_SELECTOR)) onNewMessage(node);
                    else node.querySelectorAll(MESSAGE_SELECTOR).forEach(onNewMessage);
                });
            }
        });
        listObserver.observe(list, { childList: true, subtree: true });
    };

    setInterval(() => {
        try {
            observeChat();
            if (!warnedAt) return;

            // _mainPlayer/_currentState/_isMoving/_currentTarget are the game's own (stable) field
            // names, checked against the live client (see idleWatch.js).
            const player = document.highlite?.gameHooks?.EntityManager?.Instance?._mainPlayer;
            if (!player || !settings.enabled || Date.now() - warnedAt > AUTO_CLEAR_MS) {
                clear(); // logged out / disconnected / turned off / stale
                return;
            }
            const state = player._currentState?.getCurrentState?.();
            // Anything but standing still answers the warning: skilling, combat, banking, walking…
            // The fight that was already running when the game warned counts too, so this only
            // clears once the character visibly does something new (a state change or a move).
            const active = (typeof state === 'number' && state !== ActionState.IdleState && state !== lastState)
                || Boolean(player._isMoving)
                || (player._currentTarget != null && player._currentTarget !== lastTarget);
            lastState = typeof state === 'number' ? state : lastState;
            lastTarget = player._currentTarget ?? null;
            if (active) clear();
        } catch {
            // Never let the watcher break anything else; try again next poll.
        }
    }, POLL_MS);
}
