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

// Crash-safe writes for the small JSON files in userData (settings, HUD layout, saved
// logins). A plain writeFile truncates the file first, so an app that is killed mid-write
// (an updater, a crash, a forced close) leaves an empty or half-written file behind, and the
// loader then silently falls back to defaults. Writing to a sibling temp file, flushing it,
// and renaming over the target makes the switch atomic: the old file stays intact until the
// new one is complete.

import fs from 'fs';
import path from 'path';

// Every temp name must be unique even when several writes to the same file start in the
// same millisecond, so a counter joins the pid and timestamp. Two writers sharing one temp
// name rename each other's file away.
let tempCounter = 0;
function tempPathFor(file: string): string {
    tempCounter = (tempCounter + 1) % 1_000_000;
    return `${file}.${process.pid}.${Date.now()}.${tempCounter}.tmp`;
}

// Windows refuses to rename over a file that another handle still has open — including a
// rename that is still replacing it, or an antivirus / indexer that opened the fresh file.
// A few short retries ride out that window; the error is rethrown if it persists.
const RENAME_RETRIES = 8;
const RENAME_DELAY_MS = 25;
const isTransient = (e: unknown) => {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
};

async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.promises.rename(from, to);
            return;
        } catch (e) {
            if (!isTransient(e) || attempt >= RENAME_RETRIES) throw e;
            await new Promise((r) => setTimeout(r, RENAME_DELAY_MS * (attempt + 1)));
        }
    }
}

function renameWithRetrySync(from: string, to: string): void {
    for (let attempt = 0; ; attempt++) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (e) {
            if (!isTransient(e) || attempt >= RENAME_RETRIES) throw e;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_DELAY_MS * (attempt + 1));
        }
    }
}

// Writes to the same target are queued so they land one after another. Concurrent renames
// onto one path fail on Windows, and the queue also guarantees the last call's content is
// what ends up on disk.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(file: string, task: () => Promise<T>): Promise<T> {
    const key = path.resolve(file);
    const prev = queues.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(task);
    queues.set(key, run);
    run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => undefined);
    return run;
}

export function writeFileAtomic(file: string, data: string | Buffer, mode = 0o644): Promise<void> {
    return enqueue(file, async () => {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = tempPathFor(file);
        const handle = await fs.promises.open(tmp, 'w', mode);
        try {
            await handle.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
            await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            await renameWithRetry(tmp, file);
        } catch (e) {
            await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
            throw e;
        }
    });
}

export function writeFileAtomicSync(file: string, data: string | Buffer, mode = 0o644): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = tempPathFor(file);
    const fd = fs.openSync(tmp, 'w', mode);
    try {
        fs.writeFileSync(fd, data, typeof data === 'string' ? 'utf8' : undefined);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        renameWithRetrySync(tmp, file);
    } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
    }
}

/**
 * Keep a copy of a file that failed to parse, so a reset to defaults never destroys the
 * only copy of the user's data. Returns the copy's path, or null if nothing was preserved.
 */
export function preserveCorruptFile(file: string): string | null {
    try {
        if (!fs.existsSync(file)) return null;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const copy = `${file}.corrupt-${stamp}`;
        fs.copyFileSync(file, copy);
        return copy;
    } catch {
        return null;
    }
}
