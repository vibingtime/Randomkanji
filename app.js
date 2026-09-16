'use strict';

// Leitner boxes 1-5. A card graded "Got it" moves up one box and comes back
// after this many days; "Again" drops it to box 1, which is same-session.
const INTERVALS = [0, 1, 3, 7, 21];
const DEFAULT_NEW_PER_DAY = 10;
const STORE_KEY = 'rk.v1';

const el = {
  card: document.getElementById('card'),
  kanji: document.getElementById('kanji'),
  hint: document.getElementById('hint'),
  back: document.getElementById('back'),
  sentence: document.getElementById('sentence'),
  translation: document.getElementById('translation'),
  gloss: document.getElementById('gloss'),
  settings: document.getElementById('settings'),
  openSettings: document.getElementById('open-settings'),
  closeSettings: document.getElementById('close-settings'),
  newPerDay: document.getElementById('new-per-day'),
  noLimit: document.getElementById('no-limit'),
  showEn: document.getElementById('show-en'),
  note: document.getElementById('settings-note'),
  grade: document.getElementById('grade'),
  status: document.getElementById('status'),
};

let kanji = []; // the deck, in teaching order
let cards = []; // [text, ruby, wordStart, wordLen] per kanji
let position = new Map(); // kanji -> index into the deck
let state = null;
let queue = []; // deck indices still to see this session
let current = null;
let revealed = false;

// ---- day numbers ----------------------------------------------------------

// Local-midnight day number. Stable across DST because it's rounded, and small
// enough to keep the saved state tiny.
function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.round(d.getTime() / 86400000);
}

// ---- persistence ----------------------------------------------------------

function blankState() {
  return {
    v: 1,
    box: {},
    next: 0,
    day: today(),
    newToday: 0,
    // 0 means no daily limit.
    newPerDay: DEFAULT_NEW_PER_DAY,
    showEn: true,
  };
}

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch {
    // Corrupt or unavailable (private mode, blocked storage) - start fresh.
  }
  state = saved && saved.v === 1 ? saved : blankState();
  // Saves written before these settings existed simply take the defaults.
  state.newPerDay = Number.isFinite(state.newPerDay) ? state.newPerDay : DEFAULT_NEW_PER_DAY;
  state.showEn = state.showEn !== false;

  if (state.day !== today()) {
    state.day = today();
    state.newToday = 0;
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Out of quota or storage disabled; the session still works in memory.
  }
}

// ---- queue ----------------------------------------------------------------

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueue() {
  const now = today();
  const due = [];
  for (const [literal, [, dueAt]] of Object.entries(state.box)) {
    if (dueAt <= now && position.has(literal)) due.push(position.get(literal));
  }
  // Reviews are random; only the introduction of new cards follows the deck order.
  return shuffle(due);
}

// 0 is stored for "no limit"; everything else is a straight count.
function newLimit() {
  return state.newPerDay > 0 ? state.newPerDay : Infinity;
}

function nextCard() {
  if (queue.length) return queue.shift();
  if (state.newToday < newLimit() && state.next < cards.length) {
    state.newToday++;
    return state.next++;
  }
  return null;
}

// ---- rendering ------------------------------------------------------------

// Furigana is for kanji you cannot be expected to read yet: anything the deck
// has not introduced, anything outside the deck entirely, and always the kanji
// this card is testing - the sentence is the answer side, so its reading is
// the thing you came for.
function needsFurigana(segment, target) {
  for (const ch of segment) {
    if (ch === target) return true;
    const at = position.get(ch);
    if (at === undefined || at >= state.next) return true;
  }
  return false;
}

function rubyNode(text, reading) {
  const node = document.createElement('ruby');
  node.append(text);
  const rt = document.createElement('rt');
  rt.textContent = reading;
  node.append(rt);
  return node;
}

function renderSentence(target) {
  const [text, ruby, wordStart, wordLen, gloss, translation] = cards[current];
  const chars = Array.from(text);
  const byStart = new Map(ruby.map((r) => [r[0], r]));

  const out = document.createDocumentFragment();
  let sink = out; // where characters go; swapped for the target word's span
  let i = 0;

  while (i < chars.length) {
    if (i === wordStart) {
      const word = document.createElement('span');
      word.className = 'target';
      out.append(word);
      sink = word;
    }

    const range = byStart.get(i);
    if (range) {
      const [, len, reading] = range;
      const segment = chars.slice(i, i + len).join('');
      sink.append(needsFurigana(segment, target) ? rubyNode(segment, reading) : segment);
      i += len;
    } else {
      sink.append(chars[i]);
      i += 1;
    }

    if (sink !== out && i >= wordStart + wordLen) sink = out;
  }

  el.sentence.replaceChildren(out);
  el.gloss.textContent = gloss;
  // Word-only cards carry no sentence, so there is nothing to translate.
  el.translation.textContent = state.showEn ? translation : '';
}

function render() {
  const target = kanji[current];
  el.kanji.textContent = target;
  if (revealed) renderSentence(target);

  el.back.hidden = !revealed;
  el.grade.hidden = !revealed;
  // Only ever shown on the very first card, before anything has been graded.
  el.hint.hidden = revealed || state.next > 1 || Object.keys(state.box).length > 0;
  el.card.hidden = false;
  el.status.textContent = '';
}

function finish() {
  current = null;
  el.card.hidden = true;
  el.grade.hidden = true;
  el.status.textContent =
    state.next >= cards.length && !Object.keys(state.box).length
      ? 'Deck complete.'
      : 'Nothing due right now. Come back tomorrow.';
}

function advance() {
  revealed = false;
  current = nextCard();
  if (current === null) finish();
  else render();
}

// ---- interaction ----------------------------------------------------------

function reveal() {
  if (current === null || revealed) return;
  revealed = true;
  render();
}

function grade(known) {
  if (current === null || !revealed) return;

  const literal = kanji[current];
  const box = known ? Math.min((state.box[literal]?.[0] ?? 1) + 1, INTERVALS.length) : 1;
  state.box[literal] = [box, today() + INTERVALS[box - 1]];
  save();

  // Box 1 means "again this session": drop it a few cards back so the answer
  // isn't still on screen when it returns.
  if (box === 1) {
    queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, current);
  }
  advance();
}

el.card.addEventListener('click', reveal);
document.getElementById('again').addEventListener('click', () => grade(false));
document.getElementById('got').addEventListener('click', () => grade(true));

document.addEventListener('keydown', (e) => {
  if (!el.settings.hidden) {
    if (e.key === 'Escape') closeSettings();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    reveal();
  } else if (e.key === '1') {
    grade(false);
  } else if (e.key === '2') {
    grade(true);
  }
});

// ---- settings -------------------------------------------------------------

function describeSettings() {
  if (!cards.length) return '';
  const left = cards.length - state.next;
  if (!left) return 'Every kanji in the deck has been introduced.';
  if (state.newPerDay === 0) {
    return `No limit: all ${left.toLocaleString()} remaining kanji can come up in one session, and each one you learn keeps coming back for review.`;
  }
  const days = Math.ceil(left / state.newPerDay);
  return `${left.toLocaleString()} kanji left to introduce — about ${days.toLocaleString()} ${days === 1 ? 'day' : 'days'} at this rate.`;
}

function syncSettingsUI() {
  const unlimited = state.newPerDay === 0;
  el.noLimit.checked = unlimited;
  el.newPerDay.disabled = unlimited;
  // Keep the last number visible while disabled, so unticking restores it.
  if (!unlimited) el.newPerDay.value = String(state.newPerDay);
  else if (!el.newPerDay.value) el.newPerDay.value = String(DEFAULT_NEW_PER_DAY);
  el.showEn.checked = state.showEn;
  el.note.textContent = describeSettings();
}

function openSettings() {
  syncSettingsUI();
  el.settings.hidden = false;
}

function closeSettings() {
  el.settings.hidden = true;
  // Raising the limit should take effect now rather than tomorrow: if the
  // session had ended only because no more new cards were allowed, resume.
  if (current === null) advance();
}

function readNewPerDay() {
  const n = Math.round(Number(el.newPerDay.value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, cards.length) : DEFAULT_NEW_PER_DAY;
}

el.openSettings.addEventListener('click', openSettings);
el.closeSettings.addEventListener('click', closeSettings);
el.settings.addEventListener('click', (e) => {
  if (e.target === el.settings) closeSettings();
});

el.newPerDay.addEventListener('change', () => {
  state.newPerDay = readNewPerDay();
  save();
  syncSettingsUI();
});

el.noLimit.addEventListener('change', () => {
  state.newPerDay = el.noLimit.checked ? 0 : readNewPerDay();
  save();
  syncSettingsUI();
});

el.showEn.addEventListener('change', () => {
  state.showEn = el.showEn.checked;
  save();
  if (current !== null && revealed) render();
});

// ---- boot -----------------------------------------------------------------

async function start() {
  el.status.textContent = 'Loading...';
  let data;
  try {
    const res = await fetch('kanji.json');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    el.status.textContent = 'Could not load the deck.';
    return;
  }

  kanji = Array.from(data.kanji);
  cards = data.cards;
  position = new Map(kanji.map((k, i) => [k, i]));

  load();
  state.next = Math.min(state.next, cards.length);
  queue = buildQueue();
  advance();
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
