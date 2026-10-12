// Copyright (C) 2025  HighLite

import { app, BrowserWindow, ipcMain, WebContents } from 'electron';
import path from 'path';
import fs from 'fs';
import { settingsService } from '../settingsManagement';
import { resolveGameWebContents } from '../windowRegistry';

function timestamp() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function ensureDir(dir: string): Promise<string> {
    const target = dir || app.getPath('pictures');
    await fs.promises.mkdir(target, { recursive: true });
    return target;
}

// Capture the game, not the chrome: in a multi-account window the sender is the shell page
// and the game lives in the active account's view.
async function captureGame(sender: WebContents): Promise<{ buffer: Buffer; format: 'png' } | null> {
    let wc = resolveGameWebContents(sender);
    if (!wc || wc.isDestroyed()) {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        wc = win ? win.webContents : null;
    }
    if (!wc) return null;

    const img = await wc.capturePage();
    const buffer = img.toPNG();
    return { buffer, format: 'png' };
}

export default function registerScreenshotIPC() {
    ipcMain.handle('screenshot:capture', async (event) => {
        try {
            const dirSetting = settingsService.get('Screenshots', 'Screenshot Directory') as string | undefined;
            const dir = await ensureDir(dirSetting || app.getPath('pictures'));
            const result = await captureGame(event.sender);
            if (!result) return { ok: false, error: 'No window' };

            const name = `HighspellPlus_Screenshot_${timestamp()}.png`;
            const filePath = path.join(dir, name);
            await fs.promises.writeFile(filePath, result.buffer);
            return { ok: true, path: filePath };
        } catch (e: any) {
            return { ok: false, error: e?.message || String(e) };
        }
    });
}
