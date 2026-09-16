#!/usr/bin/env node
// Builds kanji.json: for each jouyou kanji, one example sentence, the furigana
// ranges needed to read it, and an English gloss for the word being tested.
//
// Inputs (see README for how to fetch each):
//   1. KANJIDIC2 as JSON  - which kanji are jouyou, the teaching order, and the
//                           reading list used to sanity-check generated furigana
//   2. Tatoeba ja + en    - the example sentences and their translations;
//                           the two files are line-aligned
//   3. JMdict as JSON     - the gloss for the tested word, and the fallback word
//                           for kanji the corpus never uses
//   4. kuromoji + IPADIC  - word segmentation and readings, from node_modules
//
//   node --max-old-space-size=4096 tools/build-deck.mjs \
//     <KANJIS.json> <Tatoeba.en-ja.ja> <Tatoeba.en-ja.en> <jmdict-eng.json>
//
// No part of this ships to the browser.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const [kanjidicPath, corpusPath, corpusEnPath, jmdictPath] = process.argv.slice(2);
if (!kanjidicPath || !corpusPath || !corpusEnPath || !jmdictPath) {
  console.error(
    'usage: node tools/build-deck.mjs <KANJIS.json> <Tatoeba.en-ja.ja> <Tatoeba.en-ja.en> <jmdict-eng.json>'
  );
  process.exit(1);
}

const JOUYOU_GRADES = new Set([1, 2, 3, 4, 5, 6, 8]);
const CANDIDATES = 8; // sentences kept per kanji, best first, so a rejected one can be replaced

// The 2010 jouyou revision changed these glyphs. The corpus and IPADIC both
// predate it, so we match and tokenise the old form but display the current
// one. Each maps one code point to one, so ruby offsets survive the swap.
const MODERNISE = { 填: '塡', 頬: '頰', 叱: '𠮟', 剥: '剝' };

// ---- character classes ----------------------------------------------------

const code = (ch) => ch.codePointAt(0);

function isKanji(ch) {
  const c = code(ch);
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK unified
    (c >= 0x3400 && c <= 0x4dbf) || // extension A
    (c >= 0x20000 && c <= 0x2a6df) || // extension B, e.g. U+20B9F
    (c >= 0xf900 && c <= 0xfaff) // compatibility
  );
}

function toHiragana(s) {
  return Array.from(s)
    .map((ch) => {
      const c = code(ch);
      return c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
    })
    .join('');
}

// ---- furigana fitting -----------------------------------------------------

// Split a surface form into alternating kanji / non-kanji runs.
function runs(surface) {
  const out = [];
  for (const ch of Array.from(surface)) {
    const kanji = isKanji(ch);
    const last = out[out.length - 1];
    if (last && last.kanji === kanji) last.text += ch;
    else out.push({ kanji, text: ch, start: 0 });
  }
  let pos = 0;
  for (const r of out) {
    r.start = pos;
    pos += Array.from(r.text).length;
  }
  return out;
}

// Work out which part of a token's reading belongs to each kanji run. Returns
// [] when the alignment is not certain rather than guessing: wrong furigana
// teaches a wrong reading, missing furigana only teaches nothing.
function fitFurigana(surface, reading) {
  if (!reading || reading === '*') return [];
  const kana = toHiragana(reading);
  const kanaChars = Array.from(kana);
  const parts = runs(surface);
  if (!parts.some((p) => p.kanji)) return [];

  // All kanji: the reading covers the lot. Also the only correct answer for
  // jukujikun such as 今日 -> きょう, which cannot be split per character.
  if (parts.length === 1) return [[0, Array.from(surface).length, kana]];

  const result = [];
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.kanji) {
      const lit = toHiragana(part.text);
      if (!kana.startsWith(lit, pos)) return [];
      pos += Array.from(lit).length;
      continue;
    }
    const next = parts[i + 1];
    if (!next) {
      const rest = kanaChars.slice(pos).join('');
      if (!rest) return [];
      result.push([part.start, Array.from(part.text).length, rest]);
      pos = kanaChars.length;
      continue;
    }
    // The following kana run has to appear exactly once from here on, or we
    // cannot say where this kanji run's reading ends.
    const lit = toHiragana(next.text);
    const at = kana.indexOf(lit, pos + 1);
    if (at === -1 || kana.indexOf(lit, at + 1) !== -1) return [];
    const chunk = kanaChars.slice(pos, at).join('');
    if (!chunk) return [];
    result.push([part.start, Array.from(part.text).length, chunk]);
    pos = at;
  }
  if (pos !== kanaChars.length) return [];
  return result;
}

// ---- 1. the jouyou list, in teaching order --------------------------------

const kanjidic = JSON.parse(readFileSync(kanjidicPath, 'utf8'));
const jouyou = kanjidic
  .filter((k) => JOUYOU_GRADES.has(k.grade))
  .sort((a, b) => a.grade - b.grade || (a.freq ?? Infinity) - (b.freq ?? Infinity))
  .map((k) => k.literal);

if (jouyou.length !== 2136) {
  console.error(`expected 2136 jouyou kanji, got ${jouyou.length}`);
  process.exit(1);
}
const rank = new Map(jouyou.map((k, i) => [k, i]));
for (const [old, modern] of Object.entries(MODERNISE)) rank.set(old, rank.get(modern));

// Known readings per kanji, used to catch furigana the tokeniser got wrong.
const known = new Map();
for (const k of kanjidic) {
  if (!k.readings) continue;
  const set = new Set();
  for (const on of k.readings.ja_on ?? []) set.add(toHiragana(on));
  for (const kun of k.readings.ja_kun ?? []) {
    const clean = kun.replace(/-/g, '');
    set.add(clean.replace('.', ''));
    set.add(clean.split('.')[0]);
  }
  known.set(MODERNISE[k.literal] ?? k.literal, set);
}

const DEVOICED = { が:'か',ぎ:'き',ぐ:'く',げ:'け',ご:'こ',ざ:'さ',じ:'し',ず:'す',ぜ:'せ',ぞ:'そ',
  だ:'た',ぢ:'ち',づ:'つ',で:'て',ど:'と',ば:'は',び:'ひ',ぶ:'ふ',べ:'へ',ぼ:'ほ',
  ぱ:'は',ぴ:'ひ',ぷ:'ふ',ぺ:'へ',ぽ:'ほ' };

// Is `r` a believable reading of this single kanji? Allows the regular sound
// changes: rendaku (ひ -> び), gemination (いち -> いっ), and one trailing mora
// of okurigana drift.
function plausible(kanji, r) {
  const set = known.get(kanji);
  if (!set) return true; // not jouyou, no ground truth to check against
  if (set.has(r)) return true;
  const chars = Array.from(r);
  const dv = DEVOICED[chars[0]];
  if (dv && set.has(dv + chars.slice(1).join(''))) return true;
  if (chars[chars.length - 1] === 'っ') {
    const stem = chars.slice(0, -1).join('');
    for (const tail of ['ち', 'つ', 'き', 'く']) if (set.has(stem + tail)) return true;
  }
  for (const cand of set) {
    if (cand.length > 1 && Math.abs(cand.length - r.length) <= 1 &&
        (cand.startsWith(r) || r.startsWith(cand))) return true;
  }
  return false;
}

// ---- 2. shortlist sentences per kanji -------------------------------------

const ALLOWED = /^[぀-ヿ一-鿿㐀-䶿豈-﫿々ー、。！？]+$/u;

const jaLines = readFileSync(corpusPath, 'utf8').split('\n');
const enLines = readFileSync(corpusEnPath, 'utf8').split('\n');
if (jaLines.length !== enLines.length) {
  console.error(`corpus halves are not aligned: ${jaLines.length} ja vs ${enLines.length} en`);
  process.exit(1);
}

const sentences = [];
const seenText = new Set();
for (let i = 0; i < jaLines.length; i++) {
  const line = jaLines[i].trim();
  if (!line || seenText.has(line)) continue;
  const chars = Array.from(line);
  if (chars.length < 6 || chars.length > 24) continue;
  if (!'。！？'.includes(chars[chars.length - 1])) continue;
  if (!ALLOWED.test(line) || !chars.some(isKanji)) continue;
  // The halves are line-aligned, so the translation is simply the same index.
  const en = enLines[i].trim();
  if (!en) continue;
  seenText.add(line);
  const ks = chars.filter(isKanji);
  sentences.push({
    text: line,
    en,
    // Shorter is better, around 13 characters; so is surrounding the target
    // with kanji taught early rather than late.
    score: Math.abs(chars.length - 13) +
      (ks.reduce((a, k) => a + (rank.get(k) ?? 2500), 0) / ks.length) * 0.004,
    kanjiSet: new Set(ks),
  });
}

const shortlist = new Map(jouyou.map((k) => [k, []]));
for (const s of sentences) {
  for (const k of s.kanjiSet) {
    const key = MODERNISE[k] ?? k;
    const list = shortlist.get(key);
    if (!list) continue;
    list.push(s);
  }
}
for (const list of shortlist.values()) {
  list.sort((a, b) => a.score - b.score);
  list.length = Math.min(list.length, CANDIDATES);
}

// ---- 3. JMdict: word glosses, and a word for kanji the corpus never uses ---

const dictDir = require.resolve('kuromoji/package.json').replace(/package\.json$/, 'dict');

// Senses flagged archaic, obsolete or rare are not what the learner should be
// told the word in front of them means.
const SKIP_SENSE = new Set(['arch', 'obs', 'rare', 'obsc']);

const byHeadword = new Map(); // written form -> entries
const byKanjiChar = new Map(); // one kanji -> short headwords containing it

for (const w of JSON.parse(readFileSync(jmdictPath, 'utf8')).words) {
  const senses = w.sense.filter(
    (s) => !s.misc.some((m) => SKIP_SENSE.has(m)) && s.gloss.some((g) => g.lang === 'eng')
  );
  if (!senses.length) continue;
  const kana = w.kana.map((k) => k.text);
  for (const k of w.kanji) {
    const entry = { text: k.text, common: k.common, kana, senses };
    if (!byHeadword.has(k.text)) byHeadword.set(k.text, []);
    byHeadword.get(k.text).push(entry);
    if (Array.from(k.text).length > 4) continue;
    for (const ch of Array.from(k.text)) {
      if (!isKanji(ch)) continue;
      if (!byKanjiChar.has(ch)) byKanjiChar.set(ch, []);
      byKanjiChar.get(ch).push(entry);
    }
  }
}

// Two glosses at most, and short enough to read at a glance. JMdict sometimes
// carries a whole field guide entry ("crane (any bird of the family Gruidae,
// esp. ...)"), so drop the parenthetical detail before resorting to a cut.
const GLOSS_MAX = 45;

function glossOf(entry) {
  const texts = entry.senses[0].gloss.filter((g) => g.lang === 'eng').map((g) => g.text);
  const pair = texts.slice(0, 2).join(', ');
  if (pair.length <= GLOSS_MAX) return pair;
  if (texts[0].length <= GLOSS_MAX) return texts[0];
  const stripped = texts[0].replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (stripped && stripped.length <= GLOSS_MAX) return stripped;
  return (stripped || texts[0]).slice(0, GLOSS_MAX - 1).trimEnd() + '\u2026';
}

// Prefer the entry whose reading matches how the word is actually read here,
// then the one marked common: 生 alone has a dozen unrelated headwords.
function lookupGloss(forms, reading) {
  const want = reading && reading !== '*' ? toHiragana(reading) : null;
  for (const form of forms) {
    const entries = byHeadword.get(form);
    if (!entries) continue;
    const ranked = entries.slice().sort((a, b) => {
      const ar = want && a.kana.some((k) => toHiragana(k) === want) ? 1 : 0;
      const br = want && b.kana.some((k) => toHiragana(k) === want) ? 1 : 0;
      return br - ar || Number(b.common) - Number(a.common);
    });
    return glossOf(ranked[0]);
  }
  return null;
}

// For a kanji with no usable sentence: the most ordinary short word using it.
// At least two characters, so the card still shows the kanji doing something
// rather than restating itself.
// Kanji and kana only: JMdict headwords like "２桁" or "Ｔシャツ" are real
// words but make poor cards, and a digit cannot carry furigana.
const WORD_CHARS =
  /^[\u3040-\u30ff\u3005\u30fc\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2a6df}]+$/u;

function fallbackWord(kanji) {
  const entries = (byKanjiChar.get(kanji) ?? [])
    .filter((e) => Array.from(e.text).length >= 2 && WORD_CHARS.test(e.text));
  if (!entries.length) return null;
  const best = entries.slice().sort((a, b) =>
    Number(b.common) - Number(a.common) ||
    Array.from(a.text).length - Array.from(b.text).length ||
    a.text.localeCompare(b.text)
  )[0];
  return { text: best.text, reading: best.kana[0], gloss: glossOf(best) };
}

// ---- 4. turn a source string into a card ----------------------------------

const kuromoji = require('kuromoji');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: dictDir }).build((err, t) => (err ? reject(err) : resolve(t)))
);

// Returns a card, plus what is wrong with it so the caller can try the next
// candidate before settling.
function makeCard(source, literal, translation) {
  const tokens = tokenizer.tokenize(source);
  const ruby = [];
  let offset = 0;
  let wordStart = -1;
  let wordLen = 0;
  let namedKanji = false;
  let targetForms = [];
  let targetReading = null;

  for (const t of tokens) {
    const surface = t.surface_form;
    const n = Array.from(surface).length;
    // A person's name written in kanji makes the tokeniser reach for nanori
    // readings (隆 -> たかし), which are not what the card should teach.
    if (t.pos_detail_2 === '人名' && Array.from(surface).some(isKanji)) namedKanji = true;
    if (wordStart === -1 && Array.from(surface).some((c) => (MODERNISE[c] ?? c) === literal)) {
      wordStart = offset;
      wordLen = n;
      // JMdict is keyed on the dictionary form, so read んだ back to 読む.
      targetForms = t.basic_form && t.basic_form !== '*' && t.basic_form !== surface
        ? [t.basic_form, surface]
        : [surface];
      targetReading = t.reading;
    }
    for (const [at, len, reading] of fitFurigana(surface, t.reading)) {
      ruby.push([offset + at, len, reading]);
    }
    offset += n;
  }

  const text = Array.from(source).map((c) => MODERNISE[c] ?? c).join('');
  const chars = Array.from(text);

  // Drop any single-kanji reading KANJIDIC2 does not recognise.
  const kept = [];
  let dropped = 0;
  for (const r of ruby) {
    const [at, len, reading] = r;
    if (len === 1 && isKanji(chars[at]) && !plausible(chars[at], reading)) {
      dropped++;
      continue;
    }
    kept.push(r);
  }

  const covered = new Set();
  for (const [at, len] of kept) for (let i = at; i < at + len; i++) covered.add(i);
  const bare = chars.filter((c, i) => isKanji(c) && !covered.has(i)).length;
  // The card is the answer side, so the kanji being tested must always be read.
  const targetRead = wordStart !== -1 && covered.has(chars.findIndex((c) => c === literal));

  const gloss = lookupGloss(targetForms, targetReading);

  return {
    card: [text, kept, wordStart, wordLen, gloss ?? '', translation ?? ''],
    clean: dropped === 0 && bare === 0 && targetRead && !namedKanji && !!gloss,
    targetRead,
    gloss,
    dropped,
    bare,
  };
}

// ---- 5. build ------------------------------------------------------------

const stats = { sentence: 0, word: 0, compromised: 0, bare: 0 };
const cards = [];

for (const literal of jouyou) {
  let chosen = null;
  let usable = null;
  for (const s of shortlist.get(literal) ?? []) {
    const built = makeCard(s.text, literal, s.en);
    if (built.clean) { chosen = built; break; }
    // A sentence is still worth using if the only thing missing is full
    // furigana coverage elsewhere - but never if the tested word has no gloss,
    // because then there is nothing to check yourself against.
    if (!usable && built.targetRead && built.dropped === 0 && built.gloss) usable = built;
  }
  chosen ??= usable;

  if (chosen) {
    stats.sentence++;
    if (!chosen.clean) { stats.compromised++; stats.bare += chosen.bare; }
    cards.push(chosen.card);
    continue;
  }

  // No usable sentence: show the most ordinary word using this kanji instead.
  const w = fallbackWord(literal);
  if (!w) {
    console.error(`no sentence and no word for ${literal}`);
    process.exit(1);
  }
  const text = Array.from(w.text).map((c) => MODERNISE[c] ?? c).join('');
  const fitted = fitFurigana(w.text, w.reading);
  const ruby = fitted.length ? fitted : [[0, Array.from(text).length, toHiragana(w.reading)]];
  cards.push([text, ruby, 0, Array.from(text).length, w.gloss, '']);
  stats.word++;
}

const deck = {
  v: 4,
  source: 'Tatoeba (CC BY 2.0 FR), KANJIDIC2 and JMdict (CC BY-SA 4.0), IPADIC readings',
  kanji: jouyou.join(''),
  cards,
};
writeFileSync('kanji.json', JSON.stringify(deck) + '\n');

const missing = cards.filter((c) => !c[4]).length;
const translated = cards.filter((c) => c[5]).length;
const kb = (Buffer.byteLength(JSON.stringify(deck)) / 1024).toFixed(1);
console.log(`wrote kanji.json: ${cards.length} cards, ${kb} KB`);
console.log(`  from a sentence:            ${stats.sentence}`);
console.log(`  from a dictionary word:     ${stats.word}`);
console.log(`  sentences with a gap:       ${stats.compromised} (${stats.bare} kanji left unread)`);
console.log(`  cards with no gloss:        ${missing}`);
console.log(`  sentences with translation: ${translated}`);
