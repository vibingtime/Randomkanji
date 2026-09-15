#!/usr/bin/env node
// Builds kanji.json: for each jouyou kanji, one example sentence plus the
// furigana ranges needed to read it.
//
// Inputs (see README for how to fetch each):
//   1. KANJIDIC2 as JSON  - which kanji are jouyou, the teaching order, and the
//                           reading list used to sanity-check generated furigana
//   2. Tatoeba ja corpus  - the example sentences
//   3. kuromoji + IPADIC  - word segmentation and readings, from node_modules
//
//   node tools/build-deck.mjs <KANJIS.json> <Tatoeba.en-ja.ja>
//
// No part of this ships to the browser.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const [kanjidicPath, corpusPath] = process.argv.slice(2);
if (!kanjidicPath || !corpusPath) {
  console.error('usage: node tools/build-deck.mjs <KANJIS.json> <Tatoeba.en-ja.ja>');
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

const sentences = [];
const seenText = new Set();
for (let line of readFileSync(corpusPath, 'utf8').split('\n')) {
  line = line.trim();
  if (!line || seenText.has(line)) continue;
  const chars = Array.from(line);
  if (chars.length < 6 || chars.length > 24) continue;
  if (!'。！？'.includes(chars[chars.length - 1])) continue;
  if (!ALLOWED.test(line) || !chars.some(isKanji)) continue;
  seenText.add(line);
  const ks = chars.filter(isKanji);
  sentences.push({
    text: line,
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

// ---- 3. IPADIC word fallback for kanji with no usable sentence ------------

const dictDir = require.resolve('kuromoji/package.json').replace(/package\.json$/, 'dict');

function ipadicWords(wanted) {
  const tid = gunzipSync(readFileSync(dictDir + '/tid.dat.gz'));
  const pos = gunzipSync(readFileSync(dictDir + '/tid_pos.dat.gz'));
  const strAt = (off) => {
    let e = off;
    while (e < pos.length && pos[e] !== 0) e++;
    return pos.toString('utf8', off, e);
  };
  const found = new Map();
  for (let i = 0; i + 10 <= tid.length; i += 10) {
    const posId = tid[i + 6] | (tid[i + 7] << 8) | (tid[i + 8] << 16) | (tid[i + 9] << 24);
    const s = strAt(posId);
    if (!s) continue;
    let cost = (tid[i + 5] << 8) + tid[i + 4];
    if (cost > 32767) cost -= 65536;
    const f = s.split(',');
    // Proper nouns give things like "リサ堀内"; inflected forms give stems.
    if (f[2] === '固有名詞') continue;
    if ((f[1] === '動詞' || f[1] === '形容詞') && f[6] !== '基本形') continue;
    if (f[1] === '助詞' || f[1] === '助動詞' || f[1] === '記号') continue;
    const surface = f[0];
    const reading = f[8];
    if (!reading || reading === '*') continue;
    const n = Array.from(surface).length;
    if (n < 2 || n > 4) continue;
    for (const ch of Array.from(surface)) {
      const key = MODERNISE[ch] ?? ch;
      if (!wanted.has(key)) continue;
      const cur = found.get(key);
      if (!cur || cost < cur.cost) found.set(key, { text: surface, reading, cost });
    }
  }
  return found;
}

// ---- 4. turn a source string into a card ----------------------------------

const kuromoji = require('kuromoji');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: dictDir }).build((err, t) => (err ? reject(err) : resolve(t)))
);

// Returns a card, plus what is wrong with it so the caller can try the next
// candidate before settling.
function makeCard(source, literal) {
  const tokens = tokenizer.tokenize(source);
  const ruby = [];
  let offset = 0;
  let wordStart = -1;
  let wordLen = 0;
  let namedKanji = false;

  for (const t of tokens) {
    const surface = t.surface_form;
    const n = Array.from(surface).length;
    // A person's name written in kanji makes the tokeniser reach for nanori
    // readings (隆 -> たかし), which are not what the card should teach.
    if (t.pos_detail_2 === '人名' && Array.from(surface).some(isKanji)) namedKanji = true;
    if (wordStart === -1 && Array.from(surface).some((c) => (MODERNISE[c] ?? c) === literal)) {
      wordStart = offset;
      wordLen = n;
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

  return {
    card: [text, kept, wordStart, wordLen],
    clean: dropped === 0 && bare === 0 && targetRead && !namedKanji,
    targetRead,
    dropped,
    bare,
  };
}

// ---- 5. build ------------------------------------------------------------

const stats = { sentence: 0, word: 0, compromised: 0, bare: 0 };
const cards = [];
const needWord = [];

for (const literal of jouyou) {
  let chosen = null;
  let firstUsable = null;
  for (const s of shortlist.get(literal) ?? []) {
    const built = makeCard(s.text, literal);
    if (built.clean) { chosen = built; break; }
    if (!firstUsable && built.targetRead && built.dropped === 0) firstUsable = built;
  }
  chosen ??= firstUsable;
  if (chosen) {
    stats.sentence++;
    if (!chosen.clean) { stats.compromised++; stats.bare += chosen.bare; }
    cards.push(chosen.card);
  } else {
    cards.push(null);
    needWord.push(literal);
  }
}

// Anything with no usable sentence falls back to a dictionary word.
if (needWord.length) {
  const words = ipadicWords(new Set(needWord));
  for (let i = 0; i < jouyou.length; i++) {
    if (cards[i]) continue;
    const w = words.get(jouyou[i]);
    if (!w) {
      console.error(`no sentence and no word for ${jouyou[i]}`);
      process.exit(1);
    }
    const text = Array.from(w.text).map((c) => MODERNISE[c] ?? c).join('');
    const ruby = fitFurigana(w.text, w.reading);
    cards[i] = [text, ruby.length ? ruby : [[0, Array.from(text).length, toHiragana(w.reading)]],
                0, Array.from(text).length];
    stats.word++;
  }
}

const deck = {
  v: 2,
  source: 'Tatoeba (CC BY 2.0 FR), KANJIDIC2 (CC BY-SA 4.0), IPADIC readings',
  kanji: jouyou.join(''),
  cards,
};
writeFileSync('kanji.json', JSON.stringify(deck) + '\n');

const kb = (Buffer.byteLength(JSON.stringify(deck)) / 1024).toFixed(1);
console.log(`wrote kanji.json: ${cards.length} cards, ${kb} KB`);
console.log(`  from a sentence:            ${stats.sentence}`);
console.log(`  from a dictionary word:     ${stats.word}`);
console.log(`  sentences with a gap:       ${stats.compromised} (${stats.bare} kanji left unread)`);
