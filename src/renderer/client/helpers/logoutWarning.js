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

// Logout warning. The HighSpell server logs a character out after 15 minutes without an
// action. This polls the main player like idleWatch.js does and, once the character has done
// nothing for the configured number of minutes (default 14), plays a sound, shows a banner in
// the view and, inside the multi-account shell, flags the account's tab ("Logging out soon!").
// Any action (a skill, combat, walking, banking…) resets the clock and clears the warning.
// Runs in every game view, single-window or shell. Needs `document.highlite.gameHooks`, so
// client.ts starts it only when plugins are enabled (same as the idle watch).

import { ActionState } from '@ryelite/core';
import { playAlertSound } from '../../shared/alertSounds';

// One poll ≈ one game tick (the game loop runs a 600ms TIMESTEP accumulator).
const POLL_MS = 600;
const BANNER_ID = 'hsplus-logout-warning';

// Defaults must match the Alerts schema in src/preload/settings.ts (on, 14 min, Alarm, 60 %).
const settings = { enabled: true, minutes: 14, sound: 'Alarm', volume: 60 };

async function loadSettings() {
    try {
        const [enabled, minutes, sound, volume] = await Promise.all([
            window.settings.get('Alerts', 'Logout Warning'),
            window.settings.get('Alerts', 'Logout Warning After (minutes)'),
            window.settings.get('Alerts', 'Logout Warning Sound'),
            window.settings.get('Alerts', 'Logout Warning Volume (%)'),
        ]);
        settings.enabled = enabled !== false;
        settings.minutes = Math.min(60, Math.max(1, Number(minutes) || 14));
        settings.sound = typeof sound === 'string' ? sound : 'Alarm';
        settings.volume = typeof volume === 'number' && Number.isFinite(volume) ? volume : 60;
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

function showBanner(idleMinutes) {
    const left = Math.max(0, Math.round(15 - idleMinutes));
    const text = left <= 1 ? 'about a minute' : `about ${left} minutes`;
    banner().querySelector('.hsplus-logout-warning__text').textContent =
        `Logging out in ${text} — do something to stay logged in`;
    document.body.classList.add('hsplus-logout-soon');
}

function hideBanner() {
    document.body.classList.remove('hsplus-logout-soon');
}

export function initLogoutWarning() {
    void loadSettings();
    window.electron.ipcRenderer.on('settings:changed', () => {
        void loadSettings();
    });

    let lastActivity = Date.now();
    let warned = false;

    const clear = () => {
        if (warned) {
            warned = false;
            if (window.account?.embedded) window.account.clearAttention();
        }
        hideBanner();
    };

    setInterval(() => {
        try {
            // _mainPlayer/_currentState/_isMoving/_currentTarget are the game's own (stable) field
            // names, checked against the live client (see idleWatch.js).
            const player = document.highlite?.gameHooks?.EntityManager?.Instance?._mainPlayer;
            if (!player || !settings.enabled) {
                lastActivity = Date.now(); // logged out / disconnected / off: nothing to time
                clear();
                return;
            }

            const state = player._currentState?.getCurrentState?.();
            // Anything but standing still counts: skilling, combat, banking, trading, walking…
            const active = (typeof state === 'number' && state !== ActionState.IdleState)
                || Boolean(player._isMoving)
                || player._currentTarget != null;
            if (active) {
                lastActivity = Date.now();
                clear();
                return;
            }

            const idleMinutes = (Date.now() - lastActivity) / 60000;
            if (idleMinutes < settings.minutes) return;
            if (!warned) {
                warned = true;
                playAlertSound(settings.sound, settings.volume);
                if (window.account?.embedded) window.account.notifyAttention('logout');
            }
            showBanner(idleMinutes); // keeps the countdown text current
        } catch {
            // Never let the watcher break anything else; try again next poll.
        }
    }, POLL_MS);
}
