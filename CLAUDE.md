# Highspell+ (formerly RyeLite) — project notes for Claude

Electron client for the browser MMO **High Spell** (highspell.com). Fork of RyeLite (itself a fork of HighLite).
Full upstream git history is in this repo (299 commits, origin = github.com/RyeL1te/RyeliteDesktop).
Owner: Matt (GitHub `matter418`). Folder may still be named `RyeliteDesktop`.

## State as of 2026-10-11
- Branch `perf-tuning` holds all of today's work, **uncommitted**: perf fixes, rename to Highspell+, new H+ icon.
  HEAD before that was upstream `9a588f0` (v0.2.0, Dec 2025). Upstream Feb-2026 commits (Discord RPC) exist in the repo but are NOT merged in.
- `package.json` `repository`/`publish` point at `matter418/HighspellPlus` as a **placeholder** — fix to the real repo once created (auto-updater reads it).
- Dev loop: `yarn dev` (electron-vite) or the `run-*-dev.bat` scripts, which rebuild a plugin, copy it into `src/renderer/client/plugins/`, then start the dev client. Dev client serves from `localhost:5173`.
- Git from Claude's shell on this machine cannot delete `.git/*.lock` files (no delete permission) → `git stash/commit` leave stale locks. Prefer letting Matt commit, or `mv` locks aside (`.git/stale-index-lock`).
- Plugin builds use esbuild with a **Windows-only** binary in each `plugins/*/node_modules` — can't build from Claude's Linux shell; type-check with `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` instead and have Matt run the .bat.
- Pre-existing tsc errors (not ours): `src/main/windows/client/index.ts:88` unused var, several in `src/renderer/console/console.ts`.

## Architecture (what matters)
- `src/main/` = Electron main (windows: client, settings, console, updater; modules: settings, screenshots, password store).
- `src/renderer/client/client.ts` = loader: POSTs to highspell.com/game, transplants the page DOM, fetches `client.<ver>.js`, caches it in IndexedDB, injects `document.client.get/set` (eval) 9 chars before the end, then boots `@ryelite/core` (`Highlite` class) and plugins.
- `@ryelite/core` (npm, node_modules; ALSO mapped via importmap in client.html to a jsdelivr CDN copy for plugins) = Reflector (acorn-parses the game bundle to find obfuscated class names by signature, saved to IndexedDB), HookManager, PluginManager, UI/panel/settings managers.
  - **HookManager.registerClass wraps EVERY prototype+static method of ~45 game classes** (GameLoop, GameEngine, EntityManager, MeshManager, SocketManager…) with a trampoline that allocs 2 arrays and loops all plugins per call. Real CPU cost but invisible while vsync-capped. Not fixed (lives in the npm package).
  - Plugin hook methods are named `<Class>_<method>` on the plugin instance; `document.highlite.gameHooks.<Class>` exposes the real classes; `this.gameHooks.EntityManager.Instance.MainPlayer` etc.
  - PluginManager.plugins includes placeholder entries for every plugin in the remote catalog (instance undefined) → "49 plugins" = 6 local + 16 installed + ~27 catalog rows. Not duplicates.
- Names to KEEP as-is (compat): `@ryelite/core`, `@highlite/*` importmap keys, `document.highlite`, CSS classes `highlite_titlebar`/`highlite-ui`, localStorage `highlite-console-messages`, the `highlite.dev → ryelite.org` request redirect, and `Copyright (C) 2025 HighLite` GPL headers.
- Renaming productName moved userData from `%AppData%\RyeLite` to `%AppData%\Highspell+`; `src/main/index.ts` copies the old folder once if the new one is missing.
- Main-process IPC handlers (`minimize-window`, `close-window`, `ui-ready`, …) resolve the window with `BrowserWindow.fromWebContents(event.sender)` — **this returns null for a WebContentsView/BrowserView**, so a multi-tab design must route by webContents id instead.
- `app.requestSingleInstanceLock()` + `second-instance` → `createClientWindow()` (second launch opens a 2nd window in the same process).

## Perf findings (measured on Matt's PC, 165 Hz monitor)
- FPS: Highspell+ 164 fps (vsync-locked, p99 6.2 ms) vs Chrome 71 fps (12 ms). Electron is NOT slower; Chrome on his machine is. Nothing to fix for FPS.
- RAM was the real complaint. Start: 750 MB / 6 processes. End: ~611 MB / 4 processes; game renderer 586 → 426 MB (Chrome's game tab = 369 MB; Electron fixed overhead main+GPU+net ≈ 185 MB).
- Fixes applied: (1) client.ts no longer acorn-re-parses the whole game bundle on every launch (was `setTimeout 200ms`, "dev testing"), and nulls Reflector.source/ast after parsing → −84 MB heap. Opt back in with `localStorage.setItem('HSPLUS_REPARSE_HOOKS','1')`. (2) Console window created lazily on `show-console` with a 300-msg buffer in main → −1 process. (3) TileMarkers plugin `renderFrame` ran every frame and rebuilt SVG/labels with innerHTML → now early-outs when camera matrix/markers unchanged and reuses pooled elements → −127 MB. (4) Updater `error` handler so packaged builds don't hang without a release repo.
- TCG plugin holds ~30 MB of decoded appearance sheets (`sprites.ts ensureAppearance`); Matt doesn't care about TCG.
- Measuring: `perf/probe.js` (paste in F12 console; game stubs console.log so it draws an on-page box; `window.__probe`), `perf/analyze-profile.js` for .cpuprofile. Per-process RAM: Task Manager → Details → add "Command line" + "Memory" columns (`--type=renderer` / `gpu-process`). Runtime plugin disable does NOT free memory — bisect by restarting. DevTools open = an extra ~150 MB renderer.
- Dev mode (Vite/HMR) is heavier than a packaged build; `npm run build:unpack` for honest numbers.

## Branding
- Name: **Highspell+** (identifiers `highspellplus`, files `HighspellPlus-*`, appId `com.highspellplus.desktop`).
- Icon: dark slate rounded square, serif "H" in the HighSpell logo green `#00DE7A` with hard dark-green (`#007010`) down-right edge, white "+" top-right, grey bevelled base bar (option "B"). Generator: Pillow script (Inter Display Black for "+", Liberation Serif Bold for "H") — regenerate at 1024 px then export png/ico(16–256)/icns into `build/` and `static/icons/`.

## Next up (Matt's plan)
- Multi-account tabs in one window. Notes: each account needs its own renderer with an isolated `session.fromPartition('persist:acct-N')` (cookies/IndexedDB/localStorage), own loader + core + plugins; expect ~340 MB+ per tab. Likely shape: one BrowserWindow with a custom tab strip (the titlebar is already custom, `titleBarStyle: 'hidden'`) hosting one `WebContentsView` per account; fix the `fromWebContents` IPC assumption; keep `disable-renderer-backgrounding` so inactive tabs keep ticking. Saved-credential store (`userPasswordManagement`) is already multi-account.
