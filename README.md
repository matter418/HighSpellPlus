<p><img src="static/icons/icon.png" alt="Highspell+" width="128"/></p>
<p>
  <a href="https://discord.gg/highspell"><img alt="JoinDiscord" src="https://img.shields.io/badge/Discord-Join_Us-purple?style=flat&logo=Discord&label=Discord"/></a>
  <img alt="GitHub License" src="https://img.shields.io/github/license/matter418/HighSpellPlus">
  <img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/matter418/HighSpellPlus/main.yml">
  <img alt="Downloads" src="https://img.shields.io/github/downloads/matter418/HighSpellPlus/latest/total?label=Downloads&color=blue">
</p>

# Highspell+

Highspell+ is an open-source game client for High Spell, forked from [RyeLite](https://github.com/RyeL1te/RyeliteDesktop) (itself a continuation of HighLite). It keeps the full RyeLite/HighLite history and plugin compatibility (`@ryelite/core`), with its own performance fixes and features on top.

> [!NOTE]
> Download the latest installer for Windows, macOS or Linux from the [Releases](https://github.com/matter418/HighSpellPlus/releases/latest) page, or build it from source (see [Development](#development)).

## What's different from RyeLite
- **Multiple accounts in one window** (up to High Spell's limit of 6): tabs on top or bottom, a dock on the left or right with live thumbnails, or a multibox grid that shows every account at once.
- **Per-account idle alerts**: a background account's tab flashes, its view tints and an optional sound plays when its character stops what it was doing.
- **Movable, resizable HUD**: hold Alt (configurable) and drag the minimap, chat, action bars, inventory and more; drag a corner to resize; layouts are remembered, shared or per character.
- **Lower memory use**: the game bundle is no longer re-parsed on every launch, the console window is created on demand, and bundled plugins avoid per-frame DOM rebuilds.
- **Settings polish**: colour pickers, sound previews and a restart prompt only for settings that need one.

# Installing Highspell+
Highspell+ is packaged as an Electron application and provides [Linux](#Linux), [MacOS](#MacOS), and [Windows](#Windows) support.

## Windows
1. Download the `.exe` installer from the [latest release](https://github.com/matter418/HighSpellPlus/releases/latest)
2. Run the installer
3. You will be prompted by the game client when launching to automatically install any future updates!

> [!WARNING]
> In Microsoft Edge, you may receive a download warning because Highspell+ is not commonly downloaded. You can typically resolve this by clicking '...' on the download and selecting 'Keep'.

> [!WARNING]
> Highspell+ is currently unsigned, because code-signing certificates are expensive. Windows SmartScreen will warn when you run the installer: click 'More info' and then 'Run anyway'.

## Linux
1. Obtain the .AppImage file from the [latest release](https://github.com/matter418/HighSpellPlus/releases/latest)
2. Execute the AppImage
3. You will be prompted by the game client when launching to automatically install any future updates!
## MacOS
> [!CAUTION]
> MacOS builds go largely untested so they may be more prone to buggy behavior.

1. Download the `.dmg` from the [latest release](https://github.com/matter418/HighSpellPlus/releases/latest)
2. Open it and drag Highspell+ into Applications
3. The app is unsigned, so the first launch is blocked: right-click the app and choose Open, or allow it under System Settings → Privacy & Security

# Related Repositories
The Highspell+ ecosystem is distributed across multiple repositories, each serving a specific purpose in the overall architecture.

### [Desktop Application](https://github.com/matter418/HighSpellPlus)
This repository! The desktop application handles:
- Electron-based desktop application mechanics
- Window management and user interface
- Core and plugin loading system
- Auto-updater functionality
- Cross-platform builds (Windows, Linux, macOS)

### [Plugin Hub](https://github.com/matter418/HighSpellPlus-Plugin-Hub)
The list of plugins the in-app Plugin Hub offers, and the plugin bundles it installs:
- `manifest.json` — one entry per plugin, with the sha256 the client verifies each download against
- `plugins/` — the built bundles, served straight from the repository

### Plugins
The plugins written for Highspell+, each in its own repository:
- [Chat+](https://github.com/matter418/ChatPlus) — chat tabs, filters, alert words
- [Quick Deposit](https://github.com/matter418/QuickDeposit) — one-click bank and crafting quantities
- [Quick Drop](https://github.com/matter418/QuickDrop) — one-click item dropping
- [Tile Markers](https://github.com/matter418/TileMarkers) — mark tiles in the world
- [HighSpell TCG](https://github.com/matter418/HighspellTCG) — a trading card game metagame

Plugins built for other `@ryelite/core` clients work as-is; the hub also carries those that were previously available.

### Plugin API (`@ryelite/core`)
Game hooks and the plugin framework come from the `@ryelite/core` package, which Highspell+ keeps a copy of so nothing depends on anyone else's infrastructure staying up:
- `vendor/ryelite-core-0.1.1.tgz` — the package itself; `package.json` installs it from there, never from the npm registry
- `static/vendor/ryelite-core-0.1.1.js` — the same framework served to the game page as `hsplus://vendor/…`; the import map in `client.html` resolves `@ryelite/core`, `@highlite/core` and `@highlite/plugin-api` (older plugins use the old names) to it, so plugins load their framework from inside the app rather than a CDN
- [HighSpellPlus-Core](https://github.com/matter418/HighSpellPlus-Core) — a full mirror of the package's source (GPL-3.0), for when it needs changes

See [vendor/README.md](vendor/README.md) for how to move to a newer core.

# Development
## Prerequisites
- **Node.js v22 LTS** - [Download here](https://nodejs.org/en/download)
- **Yarn v4** - Managed via Corepack (comes with Node.js)

## Getting Started
1. **Clone the repository**
   ```bash
   git clone https://github.com/matter418/HighSpellPlus.git
   cd HighSpellPlus
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```
## Development Commands
### Development Mode
```bash
yarn dev          # Start development server with hot reload
yarn start        # Preview built application without packaging
run-dev.bat [PluginName ...|all]   # Windows: build the named bundled plugins, copy them in, start the dev client
```

### Building
```bash
yarn build        # Build the application for production (automatically runs prebuild)
yarn build:unpack # Build and create unpacked directory
```

### Platform-Specific Builds
```bash
yarn build:win    # Build Windows installer (.exe)
yarn build:mac    # Build macOS application (.dmg)
yarn build:linux  # Build Linux AppImage
```

### Code Quality
```bash
yarn format       # Format code with Prettier
yarn format:check # Check code formatting
yarn format:fix   # Fix formatting issues
```

## Project Structure
- **`src/main/`** - Electron Main Process (Node Client Rendering)
- **`src/preload/`** - Preload Scripts (Middle-man APIs between Node Client and Web Page)
- **`src/renderer/`** - Renderer process (Web Page Rendering)
- **`src/shared/`** - Types and constants used by all three of the above
- **`plugins/`** - Bundled plugins (each its own esbuild project; `run-dev.bat` builds them)
- **`perf/`** - Profiling helpers: `probe.js` (paste into the F12 console) and `analyze-profile.js` (for .cpuprofile files)
- **`build/`** - Application icons and build assets
