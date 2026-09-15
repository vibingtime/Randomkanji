# Random Kanji

A deliberately small flashcard PWA for the 2136 jōyō kanji. One card, two
buttons, works offline.

The front is the kanji alone. Tap it (or press space) and the back shows **one
example sentence** using it, with the tested word underlined and furigana over
the kanji you are not expected to read yet. Grade yourself **Again** or **Got
it** (keys `1` and `2`) and the next card comes up.

There is no English anywhere on the card, and no meaning or reading list — the
sentence is the whole answer.

## Which kanji get furigana

Furigana appears over a word when:

- it contains **the kanji being tested** — the back is the answer side, so its
  reading is always shown; or
- it contains a kanji the deck **has not introduced to you yet**; or
- it contains a kanji **outside the jōyō set** entirely.

Everything you have already been taught stays bare. The same sentence therefore
gets progressively harder to read as you work through the deck, which is the
point. Readings are stored per word, so compounds like 民謡(みんよう) are
annotated as a unit rather than character by character.

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

Any static file server; it needs one because of the `fetch` for the deck and
the service worker.

```sh
python3 -m http.server 8000
```

To deploy, push and turn on GitHub Pages for the branch. `start_url` and
`scope` in the manifest are relative, so serving from a `/Randomkanji/`
subpath works without changes.

When you change any cached file, bump `VERSION` in `sw.js` — otherwise the
old cache keeps being served.

## Rebuilding the deck

`kanji.json` is generated and checked in; you only need this to change what a
card holds. Three inputs:

```sh
# 1. KANJIDIC2 — which kanji are jōyō, the teaching order, and the reading
#    list used to sanity-check generated furigana
npm pack kanjidic2-json && tar xzf kanjidic2-json-*.tgz

# 2. kuromoji — word segmentation and readings (build-time only)
npm install kuromoji

# 3. A plain-text Japanese corpus, one sentence per line. This deck was built
#    from the Japanese side of the OPUS Tatoeba en-ja corpus:
#    https://opus.nlpl.eu/Tatoeba/  (or https://tatoeba.org/downloads)

node tools/build-deck.mjs package/KANJIS.json Tatoeba.en-ja.ja
```

The builder shortlists eight candidate sentences per kanji, ranked by length
and by how early the surrounding kanji appear in the deck, then takes the first
one that passes a quality gate:

- every generated single-kanji reading must be one KANJIDIC2 recognises, after
  allowing for rendaku and gemination;
- the tested kanji must end up with a reading;
- sentences containing a person's name written in kanji are rejected, because
  the tokeniser reaches for name-only readings there (隆 → たかし);
- ambiguous alignments produce no furigana rather than a guess.

Roughly 2060 kanji get a real sentence. The rest are genuinely absent from the
corpus, and fall back to the most common dictionary word using that kanji.

### A caveat on generated furigana

Readings come from a morphological analyser, not a human. It picks a valid
reading of each kanji but not always the right one for the context — 間 may be
annotated ま where あいだ is meant. Every reading is checked against KANJIDIC2,
so none of them are readings the kanji does not have, but a small number will
be contextually off.

## What this will not have

Writing these down because each will sound reasonable in three weeks:

English translations · multiple example sentences · stroke order · audio ·
radical breakdowns · multiple choice · accounts or sync · streaks · statistics ·
a settings screen

The whole app is `app.js`, and it is about 250 lines. If it passes 350,
something got in that should not have.

## Credits and licensing

Sentences come from Tatoeba (**CC BY 2.0 FR**), the kanji list and readings
from KANJIDIC2 (**CC BY-SA 4.0**), and the generated furigana from IPADIC via
kuromoji. See [CREDITS.md](CREDITS.md) — `kanji.json` combines all three and
carries their terms.
