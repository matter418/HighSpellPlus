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

// Backups of the browser-side storage that holds everything the plugin framework saves:
// the installed plugin bundles, every plugin's data (TCG collection, tile markers, …) and
// settings, and the cached game client. Chromium keeps it in userData/IndexedDB, and when
// that store is damaged — a forced close or crash while it was being written — Chromium
// quietly deletes it and starts over, which looks to the user like "all my plugins are
// gone".
//
// Defence: before any window opens (so no process has the folder open) copy userData/
// IndexedDB to userData/backups/indexeddb/<timestamp>, keeping the newest KEEP copies. When
// the loader finds a freshly created database and a backup exists, it asks the user whether
// to restore; a restore writes a request file and relaunches, and the next start swaps the
// backup in before Chromium touches the folder.
//
// Only the default profile is covered; isolated multi-account partitions keep their own
// IndexedDB under userData/Partitions and are not backed up.

import { app, dialog, ipcMain, session } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { resolveWindow } from './windowRegistry';

const KEEP = 5;

const storageDir = () => path.join(app.getPath('userData'), 'IndexedDB');
const backupRoot = () => path.join(app.getPath('userData'), 'backups', 'indexeddb');
const restoreRequestFile = () => path.join(app.getPath('userData'), 'restore-indexeddb.json');

interface BackupInfo {
    name: string;
    time: Date;
}

function stamp(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function parseStamp(name: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(name);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Newest first. */
export function listBackups(): BackupInfo[] {
    try {
        if (!fs.existsSync(backupRoot())) return [];
        return fs
            .readdirSync(backupRoot(), { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => ({ name: e.name, time: parseStamp(e.name) }))
            .filter((b): b is BackupInfo => b.time !== null)
            .sort((a, b) => b.time.getTime() - a.time.getTime());
    } catch {
        return [];
    }
}

/**
 * Copy the storage folder aside. Runs once per launch, before any window exists; a second
 * instance must not call this (the first instance has the folder open).
 */
export function snapshotIndexedDB(): void {
    try {
        const src = storageDir();
        if (!fs.existsSync(src)) return;
        const name = stamp(new Date());
        const dst = path.join(backupRoot(), name, 'IndexedDB');
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true });
        log.info(`Storage backup written: ${name}`);
        for (const old of listBackups().slice(KEEP)) {
            fs.rmSync(path.join(backupRoot(), old.name), { recursive: true, force: true });
        }
    } catch (e) {
        log.warn('Storage backup failed:', e);
    }
}

/**
 * If the previous run asked for a restore, swap the chosen backup in. Must run before any
 * window opens, and only in the instance that holds the single-instance lock.
 */
export function restoreIfRequested(): void {
    const req = restoreRequestFile();
    if (!fs.existsSync(req)) return;
    let name = '';
    try {
        name = String(JSON.parse(fs.readFileSync(req, 'utf8')).name ?? '');
    } catch {
        // unreadable request: ignore it
    }
    fs.rmSync(req, { force: true });
    if (!name || !parseStamp(name)) return;
    const src = path.join(backupRoot(), name, 'IndexedDB');
    if (!fs.existsSync(src)) {
        log.warn(`Storage restore requested but backup ${name} is missing`);
        return;
    }
    try {
        const dst = storageDir();
        // Keep what is there now too, in case the user picked the wrong backup.
        if (fs.existsSync(dst)) {
            const aside = path.join(backupRoot(), `${stamp(new Date())}-before-restore`, 'IndexedDB');
            fs.mkdirSync(path.dirname(aside), { recursive: true });
            fs.renameSync(dst, aside);
        }
        fs.cpSync(src, dst, { recursive: true });
        log.info(`Storage restored from backup ${name}`);
    } catch (e) {
        log.error('Storage restore failed:', e);
    }
}

/**
 * IPC for the loader: it calls this when it finds a freshly created database. If a backup
 * exists, ask the user; on yes, record the request and relaunch.
 */
export function registerStorageBackupIPC(): void {
    ipcMain.handle('storage:offer-restore', async event => {
        // Isolated account partitions have their own, legitimately empty, storage.
        if (event.sender.session !== session.defaultSession) return { offered: false };
        const backups = listBackups().filter(b => !b.name.endsWith('-before-restore'));
        if (backups.length === 0) return { offered: false };
        const newest = backups[0];
        const win = resolveWindow(event.sender);
        const opts: Electron.MessageBoxOptions = {
            type: 'warning',
            title: 'Plugin data was reset',
            message: 'Highspell+ found an empty plugin database.',
            detail:
                'This usually means the previous run ended abruptly and Chromium discarded the ' +
                'store that holds your installed plugins and their data.\n\n' +
                `A backup from ${newest.time.toLocaleString()} is available. Restore it? ` +
                'Highspell+ will restart.',
            buttons: ['Restore backup', 'Start fresh'],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
        };
        const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
        if (response !== 0) return { offered: true, accepted: false };
        fs.writeFileSync(restoreRequestFile(), JSON.stringify({ name: newest.name }), 'utf8');
        log.info(`Storage restore requested: ${newest.name}; relaunching`);
        app.relaunch();
        app.exit(0);
        return { offered: true, accepted: true };
    });
}
