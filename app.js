'use strict';

// Leitner boxes. A card graded "Got it" moves up one box and comes back after
// this many days; "Again" drops it to box 1, which is same-session.
//
// The steps roughly triple, which is what stops reviews piling up. The top box
// is not a graduation - cards keep coming back forever - so its interval sets
// the permanent daily load: at 180 days a finished deck of 2136 costs about
// 2136/180 = 12 reviews a day, where a 21-day top box would cost 102. Adding or
// removing a step is the whole change; the box cap follows the array length.
const INTERVALS = [0, 1, 3, 7, 21, 60, 180];
const DEFAULT_NEW_PER_DAY = 20;
// Default cards that must pass before a lapsed card is asked again, so the
// answer is off the screen and out of mind by the time it returns.
const DEFAULT_AGAIN_AFTER = 5;
const STORE_KEY = 'rk.v1';

const el = {
  card: document.getElementById('card'),
  kanji: document.getElementById('kanji'),
  hint: document.getElementById('hint'),
  back: document.getElementById('back'),
  sentence: document.getElementById('sentence'),
  translation: document.getElementById('translation'),
  gloss: document.getElementById('gloss'),
  readings: document.getElementById('readings'),
  onRow: document.getElementById('on-row'),
  kunRow: document.getElementById('kun-row'),
  on: document.getElementById('on'),
  kun: document.getElementById('kun'),
  showReadings: document.getElementById('show-readings'),
  settings: document.getElementById('settings'),
  openSettings: document.getElementById('open-settings'),
  closeSettings: document.getElementById('close-settings'),
  newPerDay: document.getElementById('new-per-day'),
  noLimit: document.getElementById('no-limit'),
  showEn: document.getElementById('show-en'),
  note: document.getElementById('settings-note'),
  about: document.getElementById('about'),
  openAbout: document.getElementById('open-about'),
  closeAbout: document.getElementById('close-about'),
  build: document.getElementById('build'),
  verdicts: document.getElementById('verdicts'),
  verdictAgain: document.getElementById('verdict-again'),
  verdictGot: document.getElementById('verdict-got'),
  swipeHint: document.getElementById('swipe-hint'),
  gradeMode: document.getElementById('grade-mode'),
  againRule: document.getElementById('again-rule'),
  againLegend: document.getElementById('again-legend'),
  againAfterInput: document.getElementById('again-after'),
  againNote: document.getElementById('again-note'),
  srReveal: document.getElementById('sr-reveal'),
  srAgain: document.getElementById('sr-again'),
  srGot: document.getElementById('sr-got'),
  status: document.getElementById('status'),
};

let kanji = []; // the deck, in teaching order
let cards = []; // [text, ruby, wordStart, wordLen] per kanji
let position = new Map(); // kanji -> index into the deck
let state = null;
let queue = []; // deck indices still to see this session
let relearn = []; // lapsed cards waiting for enough other cards to pass
let shown = 0; // cards served this session, the clock the spacing runs on
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
    showReadings: true,
    // 'swipe' | 'buttons' | 'both'
    grading: 'swipe',
    againAfter: DEFAULT_AGAIN_AFTER,
    // Where a lapsed card resumes once answered correctly again:
    // 'start' | 'two' | 'one' boxes below where it had reached.
    againDrop: 'start',
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
  state.showReadings = state.showReadings !== false;
  state.grading = ['swipe', 'buttons', 'both'].includes(state.grading) ? state.grading : 'swipe';
  state.againAfter = Number.isFinite(state.againAfter)
    ? Math.min(Math.max(1, Math.round(state.againAfter)), 20)
    : DEFAULT_AGAIN_AFTER;
  state.againDrop = ['start', 'two', 'one'].includes(state.againDrop) ? state.againDrop : 'start';
  applyGrading();

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

function againAfter() {
  return state.againAfter;
}

function swipeEnabled() {
  return state.grading !== 'buttons';
}

function applyGrading() {
  document.body.classList.toggle('grade-buttons', state.grading !== 'swipe');
}

// 0 is stored for "no limit"; everything else is a straight count.
function newLimit() {
  return state.newPerDay > 0 ? state.newPerDay : Infinity;
}

function serve(index) {
  shown++;
  return index;
}

function nextCard() {
  // A lapse that has waited long enough comes first.
  const ready = relearn.findIndex((r) => shown >= r.showAfter);
  if (ready !== -1) return serve(relearn.splice(ready, 1)[0].index);

  if (queue.length) return serve(queue.shift());

  if (state.newToday < newLimit() && state.next < cards.length) {
    state.newToday++;
    return serve(state.next++);
  }

  // Nothing left to space it out with. Better to ask early than to end the
  // session on a card that is still failing.
  if (relearn.length) return serve(relearn.shift().index);

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

// KANJIDIC2 marks the okurigana boundary with a dot ("い.きる") and affix
// position with a hyphen ("なま-"). Dim the okurigana, drop the hyphens.
function readingNode(raw) {
  const node = document.createElement('span');
  const text = raw.replace(/-/g, '');
  const dot = text.indexOf('.');
  if (dot === -1) {
    node.textContent = text;
    return node;
  }
  node.append(text.slice(0, dot));
  const oku = document.createElement('span');
  oku.className = 'oku';
  oku.textContent = text.slice(dot + 1);
  node.append(oku);
  return node;
}

function fillReadings(target, row, list) {
  target.replaceChildren(...list.map(readingNode));
  row.hidden = !list.length;
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
  const [text, ruby, wordStart, wordLen, gloss, translation, on, kun] = cards[current];
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

  el.readings.hidden = !state.showReadings;
  if (state.showReadings) {
    fillReadings(el.on, el.onRow, on ?? []);
    fillReadings(el.kun, el.kunRow, kun ?? []);
  }
}

function render() {
  const target = kanji[current];
  el.kanji.textContent = target;
  if (revealed) renderSentence(target);

  el.back.hidden = !revealed;
  el.verdicts.hidden = !revealed;
  // Offer only the control that applies, so the reader is not handed a button
  // that does nothing.
  el.srReveal.hidden = revealed;
  el.srAgain.hidden = !revealed;
  el.srGot.hidden = !revealed;
  // Both hints only ever appear on the very first card, before anything has
  // been graded: one to explain the tap, one to explain the swipe.
  const firstEver = state.next <= 1 && !Object.keys(state.box).length;
  el.hint.hidden = revealed || !firstEver;
  el.swipeHint.hidden = !revealed || !firstEver || !swipeEnabled();
  el.card.hidden = false;
  el.status.textContent = '';
}

function finish() {
  current = null;
  el.card.hidden = true;
  el.verdicts.hidden = true;
  el.srReveal.hidden = true;
  el.srAgain.hidden = true;
  el.srGot.hidden = true;
  // Reviews never stop, so there is no "finished" state to report - only
  // whether there are new kanji left to meet.
  el.status.textContent =
    state.next >= cards.length
      ? 'Nothing due right now. Every kanji has been introduced.'
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
  // A third slot remembers how far the card had climbed before it lapsed.
  // Saves written before it existed simply have nothing there.
  const [prevBox = 1, , lapsedFrom] = state.box[literal] ?? [];
  let box;
  let carry;

  if (!known) {
    // Always back to box 1, so the card is re-drilled in this session whatever
    // the resume rule says. Keep any height it had, for that rule to use.
    box = 1;
    carry = lapsedFrom ?? (prevBox > 1 ? prevBox : undefined);
  } else if (lapsedFrom && state.againDrop !== 'start') {
    const drop = state.againDrop === 'two' ? 2 : 1;
    box = Math.min(Math.max(2, lapsedFrom - drop), INTERVALS.length);
  } else {
    box = Math.min(prevBox + 1, INTERVALS.length);
  }

  const due = today() + INTERVALS[box - 1];
  state.box[literal] = carry === undefined ? [box, due] : [box, due, carry];
  save();

  // Space the re-drill by counting cards actually served rather than by
  // position in the queue: the queue is empty whenever new cards are being
  // introduced, which used to put the card straight back on screen.
  if (box === 1) {
    relearn.push({ index: current, showAfter: shown + againAfter() });
  }
  advance();
}

// Swipe left to say "Again", right to say "Got it". Pointer events rather than
// touch events, so a mouse drag on a laptop works the same way.

const TAP_SLOP = 10; // movement under this is still a tap
const FLY_MS = 200;

let pointerId = null;
let startX = 0;
let startY = 0;
let dx = 0;
let dragging = false;

// Far enough to be deliberate, near enough to reach with a thumb.
function threshold() {
  return Math.min(120, window.innerWidth * 0.28);
}

function paintDrag(offset) {
  el.card.style.transform = `translateX(${offset}px) rotate(${offset / 22}deg)`;
  const t = threshold();
  el.verdictAgain.style.opacity = offset < 0 ? String(Math.min(1, -offset / t)) : '0';
  el.verdictGot.style.opacity = offset > 0 ? String(Math.min(1, offset / t)) : '0';
}

function resetCard(animate) {
  el.verdicts.classList.remove('dragging');
  el.card.style.transition = animate ? 'transform 180ms ease-out' : 'none';
  el.card.style.transform = '';
  el.card.style.opacity = '';
  el.verdictAgain.style.opacity = '0';
  el.verdictGot.style.opacity = '0';
}

function flyAway(known) {
  el.card.style.transition = `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms ease-out`;
  el.card.style.transform =
    `translateX(${(known ? 1 : -1) * window.innerWidth}px) rotate(${known ? 14 : -14}deg)`;
  el.card.style.opacity = '0';
  setTimeout(() => {
    // Put the card back with no transition first, so the next one is already
    // centred by the time it is rendered.
    resetCard(false);
    grade(known);
  }, FLY_MS);
}

function endPointer() {
  if (pointerId !== null && el.card.hasPointerCapture(pointerId)) {
    el.card.releasePointerCapture(pointerId);
  }
  pointerId = null;
}

el.card.addEventListener('pointerdown', (e) => {
  if (current === null || pointerId !== null) return;
  pointerId = e.pointerId;
  startX = e.clientX;
  startY = e.clientY;
  dx = 0;
  dragging = false;
  el.card.style.transition = 'none';
  el.card.setPointerCapture(pointerId);
});

el.card.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (!dragging) {
    if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
    // Nothing to grade until the answer is showing, and a mostly-vertical
    // drag is not a verdict. Either way the gesture can still end as a tap.
    if (!revealed || !swipeEnabled() || Math.abs(dx) <= Math.abs(dy)) return;
    dragging = true;
    el.verdicts.classList.add('dragging');
  }
  paintDrag(dx);
});

el.card.addEventListener('pointerup', (e) => {
  if (e.pointerId !== pointerId) return;
  const swiped = dragging;
  const offset = dx;
  dragging = false;
  endPointer();

  if (!swiped) {
    resetCard(false);
    reveal();
    return;
  }
  if (Math.abs(offset) >= threshold()) flyAway(offset > 0);
  else resetCard(true);
});

el.card.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== pointerId) return;
  dragging = false;
  endPointer();
  resetCard(true);
});

// Activating one of these hides it, and the browser's fix-up then drops focus
// to the body - which lands after a synchronous focus() call and undoes it. So
// hand focus to the next live control on the following frame instead.
function handFocus(target) {
  requestAnimationFrame(() => {
    if (!target.hidden) target.focus();
  });
}

el.srReveal.addEventListener('click', () => {
  reveal();
  handFocus(el.srAgain);
});

el.srAgain.addEventListener('click', () => {
  grade(false);
  handFocus(el.srReveal);
});

el.srGot.addEventListener('click', () => {
  grade(true);
  handFocus(el.srReveal);
});

// A focused control owns its own keys: Enter and Space activate a button,
// arrows step a number field. Claiming them here would break every one of
// them - including the buttons that exist precisely for keyboard users.
function ownsKeys(node) {
  return node instanceof HTMLElement &&
    (node.isContentEditable || node.matches('button, input, select, textarea, a[href]'));
}

document.addEventListener('keydown', (e) => {
  // Innermost dialog first: About sits above Settings.
  if (!el.about.hidden) {
    if (e.key === 'Escape') {
      el.about.hidden = true;
      el.openAbout.focus();
    }
    return;
  }
  if (!el.settings.hidden) {
    if (e.key === 'Escape') closeSettings();
    return;
  }
  if (ownsKeys(e.target)) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    reveal();
  } else if (e.key === '1' || e.key === 'ArrowLeft') {
    grade(false);
  } else if (e.key === '2' || e.key === 'ArrowRight') {
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

// How long, and how many correct answers, to get a kanji back to the longest
// gap once it resumes at `fromBox`. The +1 is the answer given in the session.
function recovery(fromBox) {
  let days = 0;
  let reps = 1;
  for (let b = fromBox; b < INTERVALS.length; b++) {
    days += INTERVALS[b - 1];
    reps++;
  }
  return { days, reps };
}

function describeAgain() {
  const n = againAfter();
  const gap = `${n} ${n === 1 ? 'card' : 'cards'}`;
  const top = INTERVALS[INTERVALS.length - 1];

  if (state.againDrop === 'start') {
    const r = recovery(2);
    return `A kanji you miss comes back after ${gap}, then starts over as if it ` +
      `were new — ${r.reps} correct answers across ${r.days} days before it is ` +
      `back to a ${top}-day gap.`;
  }

  const drop = state.againDrop === 'two' ? 2 : 1;
  const resume = Math.max(2, INTERVALS.length - drop);
  const r = recovery(resume);
  return `A kanji you miss comes back after ${gap} either way. Once you get it ` +
    `right, one you had known for ${top} days returns in ${INTERVALS[resume - 1]} ` +
    `days rather than tomorrow — ${r.reps} correct answers across ${r.days} days ` +
    `to fully recover. Less to redo, but a kanji you keep forgetting drifts ` +
    `further out instead of being drilled.`;
}

function syncSettingsUI() {
  const unlimited = state.newPerDay === 0;
  el.noLimit.checked = unlimited;
  el.newPerDay.disabled = unlimited;
  // Keep the last number visible while disabled, so unticking restores it.
  if (!unlimited) el.newPerDay.value = String(state.newPerDay);
  else if (!el.newPerDay.value) el.newPerDay.value = String(DEFAULT_NEW_PER_DAY);
  el.showEn.checked = state.showEn;
  el.showReadings.checked = state.showReadings;
  for (const r of el.gradeMode.querySelectorAll('input')) r.checked = r.value === state.grading;
  el.againAfterInput.value = String(state.againAfter);
  for (const r of el.againRule.querySelectorAll('input[type="radio"]')) {
    r.checked = r.value === state.againDrop;
  }
  // Name the action the way this user actually performs it.
  el.againLegend.textContent =
    state.grading === 'buttons' ? 'When you press Again'
      : state.grading === 'swipe' ? 'When you swipe left'
        : 'When you swipe left or press Again';
  el.againNote.textContent = describeAgain();
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

// The build is whatever the service worker has cached, read live rather than
// duplicated here, so the two cannot drift apart.
async function showBuild() {
  try {
    const [name] = await caches.keys();
    el.build.textContent = name ? `Build ${name}` : '';
  } catch {
    el.build.textContent = '';
  }
}

el.openAbout.addEventListener('click', () => {
  showBuild();
  el.about.hidden = false;
  el.closeAbout.focus();
});

el.closeAbout.addEventListener('click', () => {
  el.about.hidden = true;
  el.openAbout.focus();
});

el.about.addEventListener('click', (e) => {
  if (e.target === el.about) el.about.hidden = true;
});

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

el.gradeMode.addEventListener('change', (e) => {
  if (!(e.target instanceof HTMLInputElement) || !e.target.checked) return;
  state.grading = e.target.value;
  applyGrading();
  save();
  // The "Again" legend names the gesture, so it has to follow this choice.
  syncSettingsUI();
  if (current !== null) render();
});

el.againRule.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.type === 'radio' && t.checked) state.againDrop = t.value;
  if (t === el.againAfterInput) {
    const n = Math.round(Number(el.againAfterInput.value));
    state.againAfter = Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : DEFAULT_AGAIN_AFTER;
  }
  save();
  syncSettingsUI();
});

el.showEn.addEventListener('change', () => {
  state.showEn = el.showEn.checked;
  save();
  if (current !== null && revealed) render();
});

el.showReadings.addEventListener('change', () => {
  state.showReadings = el.showReadings.checked;
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
  relearn = [];
  shown = 0;
  advance();
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
