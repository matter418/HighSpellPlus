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

import { Highlite } from '@ryelite/core'
import { Reflector } from '@ryelite/core'
import { HighliteResources } from '@ryelite/core';
import '@iconify/iconify';
import '@static/css/index.css';
import '@static/css/overrides.css';
import '@static/css/item-tooltip.css';
import '@static/css/ui-layout.css';
import '@static/css/multiaccount.css';

import './helpers/titlebarHelpers.js';
import { initUiLayout } from './helpers/uiLayout.js';
import { initAccountClose } from './helpers/accountClose.js';
import { setupWorldSelectorObserver } from './helpers/worldSelectHelper';
import { initFrameThrottle, setHidden, setHiddenFrameRate } from './helpers/frameThrottle.js';
import { initIdleWatch } from './helpers/idleWatch.js';
import { installPluginHubFilter } from './helpers/pluginHubFilter.js';

// Inside the multi-account shell this page may be hidden behind another account. Serve
// requestAnimationFrame from a slower timer pump while hidden so the game loop and socket keep
// running (see frameThrottle.js). Must be installed before the game bundle is injected.
if (window.account?.embedded) {
    initFrameThrottle();
    window.account.onVisibility(visible => setHidden(!visible));
    const applyFrameRate = async () => {
        // 15 must match the setting's default in src/preload/settings.ts.
        setHiddenFrameRate(Number(await window.settings.get('MultiAccount', 'Background Frame Rate')) || 15);
    };
    await applyFrameRate();
    window.electron.ipcRenderer.on('settings:changed', () => { void applyFrameRate(); });
}

// Load settings via centralized API (values are available via window.settings)
await window.settings.getAll();

// Reflector keeps the full client source and its acorn AST in static fields after parsing.
// Once the hook map is saved to IndexedDB nothing reads them again, so drop them.
function releaseReflectorMemory() {
    const r = Reflector as any;
    r.source = null;
    r.ast = null;
    r.classes = [];
    r.enums = [];
}

async function obtainGameClient() {
    const highspellAssetsURL = 'https://highspell.com:3002/assetsClient';

    const highliteResources = new HighliteResources();
    await highliteResources.init();

    // Check if clientLastVersion is set
    const clientLastVersion = await highliteResources.getItem('clientLastVersion');

    // Get Asset JSON to determine latest version
    const highSpellAssetJSON = await fetch(highspellAssetsURL).then(r => r.json());
    const remoteLastVersion = highSpellAssetJSON.data.latestClientVersion;

    // Load the stored hooks
    const savedHooks = await Reflector.hasSavedHooks();

    // Fetch the latest client
    async function fetchLatestClient() {

        // Define the highspell url
        const highSpellClientURL = `https://highspell.com/js/client/client.${highSpellAssetJSON.data.latestClientVersion}.js`;

        // Log the url
        console.log(highSpellClientURL);

        // Return the new client code
        return await fetch(highSpellClientURL + '?time=' + Date.now()).then(r => r.text());
    }

    let highSpellClient : string | null = null;
    if (
        clientLastVersion == undefined ||
        clientLastVersion < remoteLastVersion ||
        !savedHooks
    ) {
        console.log(
            '[Highspell+ Loader] High Spell Client Version is outdated, updating...'
        );

        // Fetch the latest client
        highSpellClient = await fetchLatestClient();

        // Reflect the game hooks
        await Reflector.loadHooksFromSource(highSpellClient);
        releaseReflectorMemory();

        // Inject the hook handlers
        highSpellClient =
            highSpellClient.substring(0, highSpellClient.length - 9) +
            '; document.client = {};' +
            'document.client.get = function(a) {' +
            'return eval(a);' +
            '};' +
            'document.client.set = function(a, b) {' +
            "eval(a + ' = ' + b);" +
            '};' +
            highSpellClient.substring(highSpellClient.length - 9);

        // Save latest version
        await highliteResources.setItem('highSpellClient', highSpellClient);
        await highliteResources.setItem('clientLastVersion', remoteLastVersion);
        console.log(
            '[Highspell+ Loader] High Spell Client Version ' +
                highSpellAssetJSON.data.latestClientVersion +
                ' downloaded.'
        );
    } else {
        console.log(
            '[Highspell+ Loader] High Spell Client Version is up to date.'
        );

        // Load the client from save db
        highSpellClient = await highliteResources.getItem('highSpellClient');

        // Load the hooks from db
        await Reflector.loadHooksFromDB();

        // NOTE: upstream re-parsed the entire game client into an AST here on every launch
        // ("for dev testing purposes"). That parse ran on the main thread during game startup
        // and the AST/source were retained for the life of the process. Hooks are already
        // loaded from the DB above, so it is now opt-in: run
        //   localStorage.setItem('HSPLUS_REPARSE_HOOKS', '1')
        // in the console if you need it while hunting for new hooks.
        if (localStorage.getItem('HSPLUS_REPARSE_HOOKS') === '1') {
            setTimeout(async () => {
                await Reflector.loadHooksFromSource(highSpellClient || '');
                releaseReflectorMemory();
            }, 200);
        }
    }

    return Promise.resolve(highSpellClient);
}

// POST Request to https://highspell.com/game
const urlencoded = new URLSearchParams();
urlencoded.append('submit', 'World+1');
urlencoded.append('serverid', '1');
urlencoded.append('serverurl', 'https://server1.highspell.com:8888');

const response = await fetch('https://highspell.com/game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: urlencoded,
    redirect: 'follow',
});
const text = await response.text();

const parser = new DOMParser();
const doc = parser.parseFromString(text, 'text/html');
const clientJS = doc.querySelector('script[src*="/js/client/client"]');
if (clientJS) {
    clientJS.remove();
}

// Replace head and body content (non-script)
Array.from(doc.head.children).forEach(child => {
    if (child.tagName.toLowerCase() !== 'script') {
        // If child has a relative href, update it to absolute
        if (child.hasAttribute('href')) {
            const href = child.getAttribute('href');
            if (href && href.startsWith('/')) {
                child.setAttribute('href', 'https://highspell.com' + href);
            }
        }
        document.head.appendChild(child.cloneNode(true));
    }
});

Array.from(doc.body.children).forEach(child => {
    if (child.tagName.toLowerCase() !== 'script') {
        // If child has a relative href, update it to absolute
        if (child.hasAttribute('href')) {
            const href = child.getAttribute('href');
            if (href && href.startsWith('/')) {
                child.setAttribute('href', 'https://highspell.com' + href);
            }
        }

        // Append the child
        document.body.appendChild(child.cloneNode(true));
    }
});

// Process and inject scripts manually
const scripts = doc.querySelectorAll('script');
scripts.forEach(script => {
    const newScript = script.cloneNode(true);
    // if script was in head, append to head
    if (
        script.parentNode &&
        (script.parentNode as Element).tagName?.toLowerCase() === 'head'
    ) {
        document.head.appendChild(newScript);
    } else {
        // if script was in body, append to body
        document.body.appendChild(newScript);
    }
});

/* Find DOM elements with the attribute to= */
const toElements = document.querySelectorAll('[to]');
toElements.forEach(element => {
    const to = element.getAttribute('to');
    if (!to) return;
    const targetElement = document.querySelector(to);

    // Check if the element has a before or after attribute
    const before = element.getAttribute('before');
    const after = element.getAttribute('after');

    // If before is set, insert the element before the target element
    if (before && !after) {
        const beforeElement = document.querySelector(before);
        if (beforeElement && beforeElement.parentNode) {
            element.remove();
            beforeElement.parentNode.insertBefore(element, beforeElement);
        }
    } else if (after && !before) {
        // If after is set, insert the element after the target element
        const afterElement = document.querySelector(after);
        if (afterElement && afterElement.parentNode) {
            element.remove();
            afterElement.parentNode.insertBefore(
                element,
                afterElement.nextSibling
            );
        }
    } else if (!after && !before) {
        // If neither before nor after is set, append the element to the target element
        // This is the default behavior
        if (targetElement) {
            element.remove();
            targetElement.appendChild(element);
        }
    } else if (after && before) {
        // If both before and after are set, log a warning
        console.warn(
            'Element has both before and after attributes. Peforming default behavior.'
        );
        if (targetElement) {
            element.remove();
            targetElement.appendChild(element);
        }
    }
});

// Inject World Selector into Login Screen
setupWorldSelectorObserver();

// Page Setup Completed, Add Game Client Script
const clientScript = document.createElement('script');
clientScript.id = 'highspellClientScript';
clientScript.textContent = await obtainGameClient();
document.body.append(clientScript);

// Page Setup Completed, Add User Helper Script
import('./helpers/userHelper').then(module => {
    module.createUserHelper();
});

// Movable / resizable HUD (modifier + drag); layout shared or per-character, see uiLayout.js.
initUiLayout();

if (await window.settings.getByName('Enable Plugins')) {
    installPluginHubFilter(); // drops the plugins Highspell+ does not offer (see pluginHubFilter.js)
    let highlite = new Highlite();

    // Load and register all plugins using dynamic imports
    console.log('[Highspell+] Loading plugins...');
    const loadedPlugins: Array<{ class: any; name: string; }> = [];

    try {
        const pluginModules = import.meta.glob('./plugins/*.js', { eager: true });

        for (const [path, moduleLoader] of Object.entries(pluginModules)) {
            try {
                const pluginName = path.split('/').pop()?.replace('.js', '') || 'UnknownPlugin';
                // Dynamically import the plugin module
                const PluginClass = (moduleLoader as any).default;

                if (PluginClass) {
                    highlite.pluginManager.registerPlugin(PluginClass);
                    loadedPlugins.push({
                        class: PluginClass,
                        name: pluginName,
                    });
                } else {
                    console.error(`[Highspell+] Plugin class not found in module: ${pluginName}`);
                }
            } catch (error) {
                console.error(`[Highspell+] Failed to load plugin from ${path}:`, error);
            }
        }
    } catch (error) {
        console.error('[Highspell+] Error loading plugins:', error);
    }
    await highlite.start();
    // Multi-account shell only: flash this account's tab when its character goes idle. Lives in
    // this branch on purpose: it reads document.highlite.gameHooks, which only exists once core
    // has run, so there is no idle alert with plugins off.
    initIdleWatch();
    initAccountClose(); // the plugin rail exists since `new Highlite()`; the button goes in it
} else {
    initAccountClose({ floating: true }); // no plugin rail: float the close button instead
    for (const element of document.getElementsByClassName('highlite-ui')) {
        element.remove();
    }
}
window.electron.ipcRenderer.send('ui-ready');
document.dispatchEvent(
    new Event('DOMContentLoaded', {
        bubbles: true,
        cancelable: true,
    })
);

