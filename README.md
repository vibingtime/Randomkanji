# Random Kanji

A deliberately small flashcard PWA for the 2136 jōyō kanji. One card, two
buttons, works offline.

Front is the kanji alone. Tap it (or press space) and the back shows the
meaning plus every on'yomi and kun'yomi KANJIDIC2 lists. Grade yourself
**Again** or **Got it** (keys `1` and `2`) and the next card comes up.

## How the scheduling works

Leitner, five boxes. **Got it** moves a card up one box, **Again** drops it
straight back to box 1.

| Box | Comes back after |
| --- | ---------------- |
| 1   | later the same session |
| 2   | 1 day  |
| 3   | 3 days |
| 4   | 7 days |
| 5   | 21 days |

Cards due for review are served in random order. New cards are *introduced* in
grade order, though — kyōiku grades 1 through 6, then the remaining jōyō, and
within each grade the most frequent kanji first. So you meet 日 and 一 long
before 璽 and 鬱, while your reviews stay shuffled. Ten new cards a day.

Progress lives in `localStorage` under `rk.v1` — about 45 KB once the whole
deck is learned. It never leaves the device, so there is nothing to sign into
and nothing to sync.

## Running it

Any static file server; it only needs one because of the `fetch` for the deck
and the service worker.

```sh
python3 -m http.server 8000
```

To deploy, push and turn on GitHub Pages for the branch. `start_url` and
`scope` in the manifest are relative, so serving from a `/Randomkanji/`
subpath works without changes.

When you change any cached file, bump `VERSION` in `sw.js` — otherwise the
old cache keeps being served.

## Rebuilding the deck

`kanji.json` is generated and checked in; you only need this if you want to
change what a card holds.

```sh
npm pack kanjidic2-json && tar xzf kanjidic2-json-*.tgz
node tools/build-deck.mjs package/KANJIS.json
```

`tools/build-deck.mjs` has no dependencies and never ships to the browser.

## What this will not have

Writing these down because each will sound reasonable in three weeks:

example words · stroke order · audio · radical breakdowns · multiple choice ·
accounts or sync · streaks · statistics · a settings screen

The whole app is `app.js`, and it is about 230 lines. If it passes 300,
something got in that should not have.

## Credits and licensing

Kanji data comes from KANJIDIC2, which is **CC BY-SA 4.0** — see
[CREDITS.md](CREDITS.md). That license attaches to `kanji.json`, so if you
redistribute it, it stays share-alike.
