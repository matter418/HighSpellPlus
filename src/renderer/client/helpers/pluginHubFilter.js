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

// Hides selected plugins from the Plugin Hub. The hub list comes from one manifest fetch inside
// @ryelite/core (PluginManager.obtainPluginConfigs), and core only loads plugins that are in
// that list, so filtering the response both removes them from the hub and keeps a previously
// installed copy from starting. Install before core boots (the fetch happens in `new Highlite()`).

const MANIFEST_URL = 'https://www.ryelite.org/api/plugins/manifest.json';

/** Hub `display_name`s to drop, compared case- and whitespace-insensitively. */
const HIDDEN_PLUGINS = ['AutoSprint', 'Item Orders', 'Lookup'];

function key(name) {
    return String(name ?? '').toLowerCase().replace(/\s+/g, '');
}

const hidden = new Set(HIDDEN_PLUGINS.map(key));

export function installPluginHubFilter() {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const response = await realFetch(input, init);
        if (url !== MANIFEST_URL || !response.ok) return response;
        try {
            const entries = await response.clone().json();
            if (!Array.isArray(entries)) return response;
            const kept = entries.filter(e => !hidden.has(key(e?.display_name)));
            return new Response(JSON.stringify(kept), {
                status: response.status,
                statusText: response.statusText,
                headers: { 'Content-Type': 'application/json' },
            });
        } catch {
            return response; // not JSON after all; let core deal with it
        }
    };
}
