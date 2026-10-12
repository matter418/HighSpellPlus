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

// The names of the alert sounds and the default volume, with no DOM or audio code, so the
// settings schema (loaded by the main process AND the preload) can build the "Idle Sound"
// dropdown from the same list the player hears. The sounds themselves are synthesised in
// src/renderer/shared/alertSounds.ts, which re-exports this list as ALERT_SOUNDS.
//
// Adding a sound: add its name here and a case in playAlertSound; the dropdown, the client
// and the Chat+ plugin all pick it up.

export const ALERT_SOUND_NAMES = ['Ding', 'Chime', 'Bell', 'Blip', 'Knock', 'Idle Alert'] as const;
export type AlertSoundName = (typeof ALERT_SOUND_NAMES)[number];

/** Default for every "… Volume (%)" setting that feeds playAlertSound. */
export const DEFAULT_ALERT_VOLUME = 60;
