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

// `hsplus://vendor/<file>`: serves the vendored plugin framework (see vendor/README.md) to the
// game page. Plugins are loaded from blob: URLs and `import` their framework by bare name;
// the import map in client.html resolves that name to this scheme. A plain file:// URL would
// not do: a blob-origin module importing file:// fails the CORS check once webSecurity is on
// (packaged builds), and file responses carry no JavaScript MIME type. This scheme is
// registered as standard + CORS-enabled and answers with the right headers.
//
// Register the scheme before app.whenReady() (registerVendorScheme), then attach the handler
// to every session that loads client.html (registerVendorProtocol): the default session and,
// when accounts are isolated, each per-account partition.

import { app, protocol, Session } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

export const VENDOR_SCHEME = 'hsplus';

/** Files allowed out of the vendor folder. Everything else is a 404. */
const VENDOR_FILES: Record<string, string> = {
    'ryelite-core-0.1.1.js': 'text/javascript; charset=utf-8',
};

export function registerVendorScheme(): void {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: VENDOR_SCHEME,
            privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
        },
    ]);
}

function vendorDir(): string {
    // Vite copies static/ into out/renderer/ for builds; in development the renderer is
    // served by the dev server and the files are read from the source tree instead.
    return app.isPackaged
        ? path.join(__dirname, '../renderer/vendor')
        : path.join(app.getAppPath(), 'static/vendor');
}

const handledSessions = new WeakSet<Session>();

export function registerVendorProtocol(ses: Session): void {
    if (handledSessions.has(ses) || ses.protocol.isProtocolHandled(VENDOR_SCHEME)) return;
    handledSessions.add(ses);
    ses.protocol.handle(VENDOR_SCHEME, async (request) => {
        const url = new URL(request.url);
        const file = path.posix.basename(url.pathname);
        const type = url.host === 'vendor' ? VENDOR_FILES[file] : undefined;
        if (!type) return new Response('Not found', { status: 404 });
        try {
            const body = await fs.readFile(path.join(vendorDir(), file));
            return new Response(body, {
                status: 200,
                headers: {
                    'Content-Type': type,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache',
                },
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}
