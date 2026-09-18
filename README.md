# Random Kanji

A deliberately small flashcard PWA for the 2136 jōyō kanji. One card, two
buttons, works offline.

The front is the kanji alone. Tap it (or press space) and the back shows **one
example sentence** using it, with the tested word underlined, furigana over the
kanji you are not expected to read yet, and **the meaning of that one word**
underneath. Then grade yourself — by default **swipe the card: left for Again,
right for Got it** — and the next one comes up. Buttons are available instead,
or as well, in settings.

Under the sentence sit two lines of English: a translation of the whole
sentence, small and dimmed, and below it the meaning of the underlined word,
which reads brighter because it is the answer to the card. The translation can
be switched off in settings if you would rather work without it.

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

## Grading

Three ways to answer, chosen in settings: **swipe** (the default), **buttons**
under the card, or **both**. Whichever is picked, the keyboard always works.

Swiping: the card follows your finger and tilts as it goes; a label fades in at the
bottom corner you are heading for, and the card flies off once you pass the
threshold — `min(120px, 28% of the width)`, far enough to be deliberate and
near enough for a thumb. Let go short of it and the card springs back without
grading.

It is built on pointer events rather than touch events, so dragging with a
mouse on a laptop behaves identically. `overscroll-behavior-x: none` is
load-bearing on Android: without it Chrome reads a rightward drag as its
swipe-to-go-back gesture and cancels the pointer mid-swipe, so a right swipe
aborted while an identical left swipe — with no forward history to navigate to —
completed normally. Horizontal only, so pull-to-refresh still works. A tap still reveals: a gesture only
counts as a swipe once it passes 10px and is more horizontal than vertical,
which also means a vertical drag never grades anything by accident. Nothing can
be graded before the answer is showing.

The keyboard still works: `space` reveals, `←` or `1` is Again, `→` or `2` is
Got it. Those shortcuts yield to whatever control has focus, so Enter still
activates a button and the arrow keys still step the number field in settings.

Neither a tap nor a swipe is available to a screen reader, so the card's three
actions also exist as real buttons — *Show answer*, *Again*, *Got it* — present
in the accessibility tree and the tab order. These are the same buttons the
grading setting shows: in swipe mode they are clipped to a pixel and out of
everyone else's way, and choosing buttons simply unclips them, so there is only
one set of controls and one set of handlers to keep honest. Only the button
that applies is exposed, activating one hands focus to whichever comes next,
and the answer is marked `aria-live` so it is read out on reveal. Even while
clipped they become visible when focused, so a sighted keyboard user does not
lose track of where they are.

## Settings

The control in the top right opens them. Two things are adjustable:

**New cards per day** — 20 by default. Raising it takes effect immediately: if
the session had already ended for the day, closing settings resumes it rather
than making you wait until tomorrow. **No daily limit** introduces new kanji
until the deck runs out, which at 2136 cards means a single session can hand
you the entire jōyō set — every one of which then comes back for review. The
review backlog that creates is real, and no interval table softens it.

**Show the English translation** — on by default, per-sentence.

**Grading** — swipe, buttons, or both.

**When you swipe left / press Again** — two knobs on what a miss costs. The
heading names whichever gesture the grading setting is currently using.

*Cards until it comes back* sets the in-session spacing: exactly that many other
cards are served before the lapsed one returns.

*Once you get it right again…* sets where the card resumes. The wording is
deliberately free of box numbers, since those are an implementation detail the
learner never otherwise sees:

| Option | Internally | A kanji known for 180 days returns in | To fully recover |
| --- | --- | --- | --- |
| Start it from scratch *(default)* | box 2 | 1 day | 6 answers, 92 days |
| Keep some of its progress | two boxes down | 21 days | 3 answers, 81 days |
| Keep most of its progress | one box down | 60 days | 2 answers, 60 days |

Below box 4 all three behave identically — the drop floors at box 2 — so the
setting only ever changes what happens to kanji already known for weeks.

The re-drill happens either way — a lapse always drops to box 1 first, so you
never skip actually recalling the card. Only the long-term interval is
forgiven. The card remembers the height it fell from in a third slot alongside
its box and due date; saves written before that slot existed simply have
nothing there and behave as they always did.

Softening cuts reviews — simulated over three years, the year-three average
falls from 19 a day to 14 at 90% recall, and from 33 to 20 at 80%. Treat those
as an upper bound rather than a prediction: the simulation holds recall fixed
regardless of scheduling, which is exactly the assumption in question. The real
cost is that a kanji you keep forgetting gets pushed further out each time
instead of being properly relearned.

**How it works** — a collapsed tutorial covering the loop, the furigana rule,
the boxes and where progress is kept.

All of these live in the same `localStorage` record as your progress, so they
survive reloads and reinstalls but do not sync between devices. Defaults apply
only where nothing is stored yet — an existing install keeps what it has.

The panel is a fixed overlay sized to `100dvh`, with the sheet centred by
`margin: auto` rather than `align-items: center` on the parent. That matters:
centring a flex item taller than its container pushes its top above the scroll
origin, where no amount of scrolling reaches it.

## How the scheduling works

Leitner, seven boxes. **Got it** moves a card up one box, **Again** drops it
straight back to box 1.

| Box | Comes back after |
| --- | ---------------- |
| 1   | later the same session, after 3&ndash;5 other cards |
| 2   | 1 day  |
| 3   | 3 days |
| 4   | 7 days |
| 5   | 21 days |
| 6   | 60 days |
| 7   | 180 days |

A lapsed card is held back until a set number of other cards have been served
(five by default, adjustable), counting cards actually shown rather than queue
length — the queue is empty
whenever new cards are being introduced, so position-based spacing put the card
straight back on screen with its answer still fresh. If nothing else is left to
space it out with, it is asked again early rather than ending the session on a
card that is still failing.

The steps roughly triple, and that taper is what keeps reviews from piling up.
The top box is not a graduation — cards keep returning forever — so its
interval fixes the permanent daily load: at 180 days a finished deck of 2136
costs about `2136 ÷ 180 ≈ 12` reviews a day. A 21-day top box would cost 102.

Simulated over three years at 10 new cards a day (the default at the time), the taper cuts the busiest
day from 167 cards to 94, and the third-year average from 131 a day to 19. It
holds up when you are not doing well, too: even at 60% recall its long-run load
stays below what a 21-day top box costs someone recalling 95%.

Cards due for review are served in random order, and reviews are never capped —
only the introduction of new cards is. New cards are *introduced* in
grade order — kyōiku grades 1 through 6, then the remaining jōyō, and
within each grade the most frequent kanji first. So you meet 日 and 一 long
before 璽 and 鬱, while your reviews stay shuffled. Twenty new cards a day.

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

The worker precaches with `cache: 'reload'` on every request. That is not
optional: GitHub Pages serves these files with `max-age`, and a plain
`addAll()` re-reads whatever is still fresh in the browser's own HTTP cache, so
a newly installed worker fills its brand new cache with the *previous*
release's bytes. Bumping `VERSION` then changes nothing anybody can see, and no
number of refreshes fixes it.

Even with that right, an already-installed client needs **two** loads to show a
new release: the first serves the old files while the new worker installs
alongside, the second serves the new ones.

## Installing it on a phone

A PWA can only be installed over **HTTPS**, so it has to be hosted somewhere —
a phone cannot install it from a file or from a plain-HTTP server on your local
network. GitHub Pages is the least effort:

1. **Settings → Pages** in the repo. Under *Build and deployment* pick
   *Deploy from a branch*, choose this branch and the `/ (root)` folder, save.
   Note that Pages only works on a **private** repo with a paid GitHub plan —
   on the free plan the repo has to be public.
2. Wait a minute, then open `https://<user>.github.io/<repo>/` on the phone.
3. **Android (Chrome):** menu → *Add to Home screen* / *Install app*.
   **iPhone (Safari):** Share → *Add to Home Screen*. Use Safari — installing
   from other iOS browsers is unreliable.
4. Open it once while online so the service worker caches the deck. After that
   it runs with no network at all.

It installs as a standalone app: no browser chrome, its own home screen icon,
and progress kept on the device.

Any other static host works the same way — Cloudflare Pages and Netlify both
serve private repos on their free tiers, and both accept a drag-and-dropped
folder if you would rather not connect the repo at all.

### Icons

`apple-touch-icon.png`, `icon-192.png` and `icon-512.png` are generated from
`icon.svg` and checked in. iOS ignores SVG for the home screen icon, so without
the PNG an installed app shows a screenshot of the page instead of the mark.
Regenerate them only if `icon.svg` changes:

```sh
npm install playwright && node tools/make-icons.mjs
```

## Rebuilding the deck

`kanji.json` is generated and checked in; you only need this to change what a
card holds. Four inputs:

```sh
# 1. KANJIDIC2 — which kanji are jōyō, the teaching order, and the reading
#    list used to sanity-check generated furigana
npm pack kanjidic2-json && tar xzf kanjidic2-json-*.tgz

# 2. kuromoji — word segmentation and readings (build-time only)
npm install kuromoji

# 3. A plain-text Japanese corpus, one sentence per line. This deck was built
#    from the OPUS Tatoeba en-ja corpus. BOTH halves are needed: the .ja file
#    supplies the sentences and the .en file their translations, and the two
#    are line-aligned (the builder refuses to run if they are not).
#    https://opus.nlpl.eu/Tatoeba/  (or https://tatoeba.org/downloads)

# 4. JMdict as JSON — the word glosses, and the fallback word for any kanji the
#    corpus never uses. Grab jmdict-eng-*.json.zip from the latest release of
#    https://github.com/scriptin/jmdict-simplified and unzip it.

node --max-old-space-size=4096 tools/build-deck.mjs \
  package/KANJIS.json Tatoeba.en-ja.ja Tatoeba.en-ja.en jmdict-eng-3.6.2.json
```

The JMdict JSON is ~118 MB once unzipped, hence the heap flag.

The builder shortlists eight candidate sentences per kanji, ranked by length
and by how early the surrounding kanji appear in the deck, then takes the first
one that passes a quality gate:

- every generated single-kanji reading must be one KANJIDIC2 recognises, after
  allowing for rendaku and gemination;
- the tested kanji must end up with a reading;
- the tested word must have a JMdict gloss, otherwise there is nothing to check
  yourself against — this also quietly rejects sentences whose target turns out
  to be a place or person name (成田空港, 佐藤), since those are not dictionary
  words;
- sentences containing a person's name written in kanji are rejected, because
  the tokeniser reaches for name-only readings there (隆 → たかし);
- ambiguous alignments produce no furigana rather than a guess.

Roughly 2050 kanji get a real sentence. The rest are genuinely absent from the
corpus, and fall back to the most ordinary JMdict word using that kanji — at
least two characters, kanji and kana only, common entries preferred.

Glosses are capped at 45 characters. JMdict occasionally carries a field-guide
entry ("crane (any bird of the family Gruidae, esp. ...)"); the builder drops
the parenthetical detail before it resorts to truncating.

### A caveat on generated furigana

Readings come from a morphological analyser, not a human. It picks a valid
reading of each kanji but not always the right one for the context — 間 may be
annotated ま where あいだ is meant. Every reading is checked against KANJIDIC2,
so none of them are readings the kanji does not have, but a small number will
be contextually off.

## What this will not have

Writing these down because each will sound reasonable in three weeks:

multiple example sentences · kanji meaning lists · reading lists · stroke
order · audio · radical breakdowns · multiple choice · accounts or sync ·
streaks · statistics

The whole app is `app.js`, and it is about 350 lines. Sentence translations and
a settings screen were both on this list until they were asked for, which is
the honest history of any such list.

## Credits and licensing

Sentences and their translations come from Tatoeba (**CC BY 2.0 FR**); the kanji list and readings
from KANJIDIC2 and the word glosses from JMdict, both EDRDG and both
**CC BY-SA 4.0**; the generated furigana from IPADIC via kuromoji. See
[CREDITS.md](CREDITS.md) — `kanji.json` combines all of them and carries their
terms.
