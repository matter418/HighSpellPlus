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

function tempPathFor(file: string): string {
    return `${file}.${process.pid}.${Date.now()}.tmp`;
}

export async function writeFileAtomic(file: string, data: string | Buffer, mode = 0o644): Promise<void> {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = tempPathFor(file);
    const handle = await fs.promises.open(tmp, 'w', mode);
    try {
        await handle.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.promises.rename(tmp, file);
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
    fs.renameSync(tmp, file);
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
