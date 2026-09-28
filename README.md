# Enoki

[Open Enoki](https://atsushisakai.github.io/Enoki/) · [Source repository](https://github.com/AtsushiSakai/Enoki)

A browser app for writing Japanese with an English keyboard. Type romaji, choose kanji, and copy your text. All interface labels, instructions, emoji names, and status messages are in English.

## Start

```sh
python3 serve.py
```

Open http://127.0.0.1:4173 in Chrome. Run the command from this directory on macOS or Ubuntu with Python 3 installed. Use an HTTP server, not `file://`, so the conversion worker can run. No npm install or production build is required; scripts, dictionaries, and emoji data are bundled locally.

## Typing

- Type romaji, such as `nihongo`, to compose hiragana.
- Space: convert to kanji / next candidate. Up/down: choose a candidate. 1–9: choose a numbered candidate.
- Left/right: move between phrase segments. Shift+left/right: change segment length.
- Enter: confirm, then press again for a new line. Esc: revert conversion / cancel composition.
- F6/F7: confirm as hiragana / katakana.
- The Japanese input button or Ctrl+Space switches both fields between Japanese and English. Use the button if the OS intercepts the shortcut.
- Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z: undo / redo. Command shortcuts also work on macOS.
- Search emoji in Japanese, or switch to English input for keywords such as `cat`. Click an emoji to insert it at the last editor cursor position.
- Copy text, Search Google, Clear all, and grapheme-based character counting are available.

## Privacy and offline access

Conversion and emoji search run entirely in the browser. Enoki does not upload text, keystrokes, or emoji search queries, and has no analytics or external conversion API. Clicking **Search Google** opens a new tab and sends the current editor text to Google as a search query.

Initial loading and updates download application files, dictionaries, and notices from the site's host. Those requests do not include what you type. Like any website, hosting involves ordinary network requests; the privacy promise concerns your input content.

Drafts and conversion learning are not persisted. Undo history lives only in the tab's memory; copy your text before closing or reloading. Offline storage contains only public application assets and dictionaries.

After **Ready for offline use** appears, the same URL supports Japanese input, emoji search, and license viewing offline. Clearing site data or browser cache eviction requires another download. The initial compressed dictionary is about 12.6 MiB and WebAssembly about 2.6 MiB. Loading progress is displayed before input becomes available.

## Open-source notices

Choose **Open-source licenses** in the footer to read full copyright notices and license terms in an accessible dialog. The notices are local and included in the offline cache. Original legal wording is preserved, including the Japanese public-domain notice for the Okinawa dictionary.

`licenses/catalog.json` contains the displayed text; separate originals and source checksums are in `licenses/`. The catalog covers Hechima and KeymapEngine, Mozc and its dictionary, fcitx5-mozc, React bundled with KeymapEngine, Abseil, Protocol Buffers, the Emscripten runtime, and Unicode data. The original upstream `mozc-notices.md` is retained as provenance; its unrelated jsQR section is not part of Enoki's catalog.

## Implementation and validation

- Plain HTML, CSS, and JavaScript. No backend or external CDN.
- Hechima 0.24.0, KeymapEngine 2.10.0, Mozc WASM 0.7.1 (single-thread). Asset sources and hashes: `vendor/manifest.json`; build revisions: `vendor/hechima-wasm/BUILD_INFO.txt`.
- The conversion integration is experimental and does not reproduce every OS IME feature.
- Unicode Emoji 17.0 / CLDR 48: 1,914 entries excluding skin-tone variants, across nine categories. Japanese and English keywords remain searchable. Emoji rendering depends on the OS font.
- Development tests use Node.js, Playwright, Chrome, and the running local server. Run `npm install` then `npm test`. Set `CHROME_PATH`, `PLAYWRIGHT_MODULE`, or `TEST_BASE_URL` when needed.
- Tests use a temporary browser profile and save actual screenshots in `artifacts/`. Coverage includes real kanji conversion, candidates, clipboard, undo, emoji input, full license notices, offline reload, and absence of third-party page requests during local use.
- Verified with Chrome on macOS. Ubuntu hardware has not yet been tested.

## GitHub Pages deployment and updates

The site is served from the `main` branch root using GitHub Pages. `.nojekyll` keeps the static assets unchanged, including the compressed dictionary. Keep assets at relative paths for project URLs such as `/Enoki/`. On release, update the version in `sw.js`, the version check in `app.js`, and versioned asset URLs in HTML/JS. An existing open tab keeps its text; reload after copying it to load the latest interface. For development, unregister the service worker and clear Cache Storage if an old version persists. The Enoki worker cleans up this application's previous Kotoba cache within the same URL scope.
