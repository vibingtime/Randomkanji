'use strict';

// Leitner boxes 1-5. A card graded "Got it" moves up one box and comes back
// after this many days; "Again" drops it to box 1, which is same-session.
const INTERVALS = [0, 1, 3, 7, 21];
const NEW_PER_DAY = 10;
const STORE_KEY = 'rk.v1';

const el = {
  card: document.getElementById('card'),
  kanji: document.getElementById('kanji'),
  hint: document.getElementById('hint'),
  back: document.getElementById('back'),
  meaning: document.getElementById('meaning'),
  onRow: document.getElementById('on-row'),
  kunRow: document.getElementById('kun-row'),
  on: document.getElementById('on'),
  kun: document.getElementById('kun'),
  grade: document.getElementById('grade'),
  status: document.getElementById('status'),
};

let deck = [];
let position = new Map(); // literal -> index into deck
let state = null;
let queue = []; // deck indices still to see this session
let current = null; // deck index currently on screen
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
  return { v: 1, box: {}, next: 0, day: today(), newToday: 0 };
}

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch {
    // Corrupt or unavailable (private mode, blocked storage) - start fresh.
  }
  state = saved && saved.v === 1 ? saved : blankState();

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
  // Reviews are random; only the introduction of new cards follows grade order.
  return shuffle(due);
}

function nextCard() {
  if (queue.length) return queue.shift();
  if (state.newToday < NEW_PER_DAY && state.next < deck.length) {
    state.newToday++;
    return state.next++;
  }
  return null;
}

// ---- rendering ------------------------------------------------------------

// KANJIDIC2 marks the okurigana boundary with a dot ("い.きる") and affix
// position with a hyphen ("なま-"). Dim the okurigana, drop the hyphens.
function readingNode(raw) {
  const span = document.createElement('span');
  const text = raw.replace(/-/g, '');
  const dot = text.indexOf('.');
  if (dot === -1) {
    span.textContent = text;
    return span;
  }
  span.append(text.slice(0, dot));
  const oku = document.createElement('span');
  oku.className = 'oku';
  oku.textContent = text.slice(dot + 1);
  span.append(oku);
  return span;
}

function fillReadings(target, row, list) {
  target.replaceChildren(...list.map(readingNode));
  row.hidden = list.length === 0;
}

function render() {
  const [literal, , on, kun, meanings] = deck[current];
  el.kanji.textContent = literal;
  el.meaning.textContent = meanings.join(', ');
  fillReadings(el.on, el.onRow, on);
  fillReadings(el.kun, el.kunRow, kun);

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
    state.next >= deck.length && !Object.keys(state.box).length
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

  const literal = deck[current][0];
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
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    reveal();
  } else if (e.key === '1') {
    grade(false);
  } else if (e.key === '2') {
    grade(true);
  }
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

  deck = data.cards;
  position = new Map(deck.map((c, i) => [c[0], i]));

  load();
  state.next = Math.min(state.next, deck.length);
  queue = buildQueue();
  advance();
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
