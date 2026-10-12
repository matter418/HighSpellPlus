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

// Idle watcher for accounts hosted in the multi-account shell (ported from the mobile
// client's idle-watch.ts). Polls the main player's action state on a plain timer, which keeps
// running at full speed in a hidden view even though the rAF-driven game loop is throttled.
// When a real action (woodcutting, fishing, combat…) settles into idle for the configured
// delay, the shell is told to flash this account's tab. Detection mirrors the Idle Alert
// plugin tick-for-tick, so the two agree on when a character is AFK; the sound is off by
// default to avoid doubling up with that plugin.

import { ActionState } from '@ryelite/core';
import { playAlertSound } from '../../shared/alertSounds';

// One poll ≈ one game tick (the game loop runs a 600ms TIMESTEP accumulator).
const POLL_MS = 600;

const IGNORED_STATES = [
    ActionState.BankingState,
    ActionState.ClimbSameMapLevelState,
    ActionState.GoThroughDoorState,
    ActionState.PlayerLoggingOutState,
    ActionState.PlayerDeadState,
    ActionState.StunnedState,
    ActionState.TradingState,
];

const settings = { enabled: true, delaySeconds: 12, sound: 'Off', volume: 60, color: '#f9f449' };

async function loadSettings() {
    try {
        const [enabled, delay, sound, volume, color] = await Promise.all([
            window.settings.get('MultiAccount', 'Idle Alert'),
            window.settings.get('MultiAccount', 'Idle Alert Delay (seconds)'),
            window.settings.get('MultiAccount', 'Idle Sound'),
            window.settings.get('MultiAccount', 'Idle Sound Volume (%)'),
            window.settings.get('MultiAccount', 'Idle Alert Color'),
        ]);
        settings.enabled = enabled !== false;
        settings.delaySeconds = Math.max(1, Number(delay) || 12);
        settings.sound = typeof sound === 'string' ? sound : 'Off';
        settings.volume = Number.isFinite(Number(volume)) ? Number(volume) : 60;
        settings.color = /^#[0-9a-fA-F]{6}$/.test(String(color)) ? String(color) : '#f9f449';
        document.documentElement.style.setProperty('--hsplus-idle-color', settings.color);
    } catch {
        // keep defaults
    }
}

// ---- watcher --------------------------------------------------------------------------------

export function initIdleWatch() {
    if (!window.account || !window.account.embedded) return;

    void loadSettings();
    window.electron.ipcRenderer.on('settings:changed', () => {
        void loadSettings();
    });

    let lastActionState = ActionState.IdleState;
    let idlePolls = 0;
    let shouldTick = false;
    let alerting = false;

    const clearAlert = () => {
        if (alerting) {
            alerting = false;
            window.account.clearAttention();
        }
        document.body.classList.remove('hsplus-idle');
    };

    // Looking at the account (clicking into its view) answers the alert, like switching tabs.
    window.addEventListener('focus', clearAlert);

    const reset = () => {
        lastActionState = ActionState.IdleState;
        idlePolls = 0;
        shouldTick = false;
    };

    setInterval(() => {
        try {
            if (!settings.enabled) {
                reset();
                clearAlert();
                return;
            }

            const player = document.highlite?.gameHooks?.EntityManager?.Instance?._mainPlayer;
            if (!player) {
                reset();
                clearAlert(); // logged out / disconnected
                return;
            }

            const state = player._currentState?.getCurrentState?.();
            if (typeof state !== 'number' || IGNORED_STATES.includes(state)) {
                return;
            }

            // Character is doing something again — alert is stale.
            if (state !== ActionState.IdleState) {
                clearAlert();
            }

            // Manual movement is not an AFK action (plugin parity).
            if (player._isMoving && player._currentTarget == null && state === ActionState.IdleState) {
                shouldTick = false;
                lastActionState = ActionState.IdleState;
                return;
            }
            shouldTick = true;

            if (state !== ActionState.IdleState) {
                lastActionState = state;
            }

            if (
                state === ActionState.IdleState &&
                lastActionState !== ActionState.IdleState &&
                player._currentTarget == null &&
                shouldTick
            ) {
                idlePolls++;
            } else {
                idlePolls = 0;
            }

            const neededPolls = Math.max(1, Math.round((settings.delaySeconds * 1000) / POLL_MS));
            if (idlePolls > neededPolls) {
                playAlertSound(settings.sound, settings.volume);
                window.account.notifyAttention('idle');
                alerting = true;
                // In-page cue (pulsing border): visible in the Multibox grid where no tab exists.
                if (!document.hasFocus()) document.body.classList.add('hsplus-idle');
                lastActionState = ActionState.IdleState;
                idlePolls = 0;
            }
        } catch {
            // Never let the watcher break anything else; try again next poll.
        }
    }, POLL_MS);

    // Debug handle for the F12 console.
    window.__hsplusIdleWatch = () => ({ lastActionState, idlePolls, shouldTick, alerting, settings: { ...settings } });
}
