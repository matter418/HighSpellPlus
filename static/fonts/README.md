# Bundled fonts

`NotoColorEmoji-COLRv1.ttf` is Google's Noto Color Emoji (COLRv1 vector build) from
https://github.com/googlefonts/noto-emoji/tree/main/2D/fonts, licensed under the SIL Open
Font License 1.1 (`LICENSE-NotoColorEmoji.txt`).

The plugin framework draws its side-rail buttons and several panel controls as emoji
characters. Windows and macOS always have a colour emoji font, but many Linux desktops
(Linux Mint among them) ship none, which left the rail blank. `static/css/emoji-font.css`
declares this file as a web font named `HS+ Emoji`, served through `hsplus://fonts/`, and
lists it after the platform emoji fonts so it is only used where no system font covers the
glyph. `package.json` leaves the folder out of the Windows and macOS packages.
