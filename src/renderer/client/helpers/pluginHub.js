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

// Points the Plugin Hub at the Highspell+ hub repository instead of the upstream service.
//
// @ryelite/core hardcodes two upstream URLs: it fetches the hub list from CORE_MANIFEST_URL
// (PluginManager.obtainPluginConfigs) and downloads each plugin from
// `${CORE_ASSET_PREFIX}<owner>/<display_name>/` (downloadAndVerifyAsset), then checks the
// bytes against the entry's asset_sha. Both URLs are rewritten here, before core boots (the
// manifest fetch happens inside `new Highlite()`), so nothing is ever requested from upstream:
//   - the manifest comes from HUB_BASE/manifest.json
//   - a plugin's bundle comes from HUB_BASE/plugins/<repository_name>.js (or the entry's
//     optional `asset` path), served by raw.githubusercontent.com, which allows cross-origin
//     reads. GitHub release downloads do not, which is why the hub repo carries the bundles.
// A plugin that is not in the hub manifest gets a 404, so a previously installed copy of a
// plugin we dropped never loads either (core only loads plugins present in the list).

const HUB_BASE = 'https://raw.githubusercontent.com/matter418/HighSpellPlus-Plugin-Hub/main';
const HUB_MANIFEST_URL = `${HUB_BASE}/manifest.json`;

const CORE_MANIFEST_URL = 'https://www.ryelite.org/api/plugins/manifest.json';
const CORE_ASSET_PREFIX = 'https://www.ryelite.org/api/plugins/';

/** Case- and whitespace-insensitive key, matching how core compares display names. */
function key(name) {
    return String(name ?? '').toLowerCase().replace(/\s+/g, '');
}

function decode(part) {
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
}

export function installPluginHub() {
    const realFetch = window.fetch.bind(window);
    let entries = [];

    const loadManifest = async () => {
        const response = await realFetch(HUB_MANIFEST_URL, { cache: 'no-cache' });
        if (response.ok) {
            try {
                const parsed = await response.clone().json();
                if (Array.isArray(parsed)) entries = parsed;
            } catch {
                // not JSON; core will report the failure
            }
        }
        return response;
    };

    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        if (url === CORE_MANIFEST_URL) return loadManifest();

        if (url.startsWith(CORE_ASSET_PREFIX)) {
            const [owner, name] = url
                .slice(CORE_ASSET_PREFIX.length)
                .replace(/\/+$/, '')
                .split('/')
                .map(decode);
            if (!entries.length) await loadManifest();
            const entry = entries.find(
                e =>
                    key(e?.repository_owner) === key(owner) &&
                    key(e?.display_name ?? e?.repository_name) === key(name)
            );
            if (!entry) {
                return new Response(`${owner}/${name} is not in the Highspell+ plugin hub`, {
                    status: 404,
                    statusText: 'Not Found',
                });
            }
            const asset = entry.asset ?? `plugins/${entry.repository_name}.js`;
            return realFetch(`${HUB_BASE}/${asset}`, { cache: 'no-cache' });
        }

        return realFetch(input, init);
    };
}
