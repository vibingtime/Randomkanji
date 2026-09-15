#!/usr/bin/env node
// Builds kanji.json (the jouyou deck) from a KANJIDIC2 JSON dump.
//
// Source data: KANJIDIC2 by the Electronic Dictionary Research and Development
// Group, licensed CC BY-SA 4.0. See CREDITS.md.
//
// Getting the input (the raw XML lives on www.edrdg.org, but the npm mirror is
// easier to script against and is a straight XML -> JSON conversion):
//
//   npm pack kanjidic2-json && tar xzf kanjidic2-json-*.tgz
//   node tools/build-deck.mjs package/KANJIS.json
//
// Writes kanji.json in the repo root. No dependencies; this never ships to the
// browser.

import { readFileSync, writeFileSync } from 'node:fs';

const MAX_MEANINGS = 4;

// Grades 1-6 are the kyouiku kanji taught in elementary school; grade 8 is the
// rest of the jouyou set. Grades 9-10 are jinmeiyou (name kanji) and are out.
const JOUYOU_GRADES = new Set([1, 2, 3, 4, 5, 6, 8]);

const input = process.argv[2];
if (!input) {
  console.error('usage: node tools/build-deck.mjs <path-to-KANJIS.json>');
  process.exit(1);
}

const all = JSON.parse(readFileSync(input, 'utf8'));

const cards = all
  .filter((k) => JOUYOU_GRADES.has(k.grade))
  .sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    // Within a grade, common kanji first. KANJIDIC2 only ranks the top 2500,
    // so unranked ones sort to the back of their grade.
    return (a.freq ?? Infinity) - (b.freq ?? Infinity);
  })
  .map((k) => [
    k.literal,
    k.grade,
    k.readings.ja_on ?? [],
    k.readings.ja_kun ?? [],
    k.meanings.en.slice(0, MAX_MEANINGS),
  ]);

if (cards.length !== 2136) {
  console.error(`expected 2136 jouyou kanji, got ${cards.length}`);
  process.exit(1);
}

const deck = { v: 1, source: 'KANJIDIC2 (EDRDG), CC BY-SA 4.0', cards };
writeFileSync('kanji.json', JSON.stringify(deck) + '\n');

const bytes = Buffer.byteLength(JSON.stringify(deck));
console.log(`wrote kanji.json: ${cards.length} cards, ${(bytes / 1024).toFixed(1)} KB`);
