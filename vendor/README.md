# Vendored dependencies

Highspell+ must keep working even if the upstream projects it was built from disappear,
so the pieces that used to be fetched from other people's infrastructure live here.

| File | What it is | Used by |
|---|---|---|
| `ryelite-core-0.1.2-hsplus.1.tgz` | `@ryelite/core` built from the Highspell+ mirror: upstream 0.1.2 plus the fix for plugins installed mid-session (see the mirror's history). | `package.json` installs it from this file, so builds never contact the npm registry for it. |
| `../static/vendor/ryelite-core-0.1.2-hsplus.1.js` | `dist/index.js` from that package: the plugin framework (`Highlite`, `Plugin`, hook and plugin managers), already bundled with its own dependencies. | Served to the game page as `hsplus://vendor/ryelite-core-0.1.2-hsplus.1.js`; the import map in `src/renderer/client.html` points `@ryelite/core`, `@highlite/core` and `@highlite/plugin-api` at it, so plugins resolve their framework import inside the app instead of from a CDN. |

The source of this package is mirrored at https://github.com/matter418/HighSpellPlus-Core
(GPL-3.0). To move to a newer core: drop the new tarball here, extract its `dist/index.js`
into `static/vendor/`, update the three references above, and run `yarn install`.
