import { dayIn } from '../state.js';
import { readJournal } from './journal.js';
import { readStoredJson } from '../storage.js';
import { playPath } from './store.js';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';

function validMonth(month) {
  if (typeof month !== 'string' || month.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const year = Number(month.slice(0, 4));
  return year >= 1;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(monthNumber) ? 30 : 31;
}

function datesInMonth(month) {
  const count = daysInMonth(month);
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function isTimestamp(at) {
  return Number.isSafeInteger(at) && Math.abs(at) <= 8_640_000_000_000_000;
}

function validMeal(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.id === 'string' && entry.id.trim() && isTimestamp(entry.at);
}

function validActivity(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.activity === 'string' && entry.activity.trim() && isTimestamp(entry.at)
    && (entry.note === undefined || typeof entry.note === 'string');
}

function hasActualInEaten(eaten, date, timezone, nowMs) {
  for (const entry of eaten) {
    if (!validMeal(entry) || entry.at > nowMs) continue;
    try {
      if (dayIn(timezone, entry.at) === date) return true;
    } catch { /* Ignore an invalid timestamp; other valid records remain usable. */ }
  }
  return false;
}

function hasActualInPlay(play, date, timezone, nowMs) {
  for (const entry of play?.done ?? []) {
    if (!validActivity(entry) || entry.at > nowMs) continue;
    try {
      if (dayIn(timezone, entry.at) === date) return true;
    } catch { /* Ignore an invalid timestamp; other valid records remain usable. */ }
  }
  return false;
}

/**
 * Read a single calendar month without consulting plan files or scanning history.
 * At most four date workers run concurrently; each reads only that day's play and journal files.
 */
export async function readCalendarMonth(dataDir, month, {
  eaten = [], recordsAvailable = Array.isArray(eaten), nowMs = Date.now(), timezone = DEFAULT_TIMEZONE,
} = {}) {
  if (!validMonth(month)) throw new Error('月份必须是严格合法的 YYYY-MM。');
  if (!Number.isSafeInteger(nowMs) || Math.abs(nowMs) > 8_640_000_000_000_000) {
    throw new Error('当前时间无效。');
  }
  // Validate the zone before opening any files.
  const today = dayIn(timezone, nowMs);
  const knownEaten = Array.isArray(eaten) ? eaten : [];
  const mealSourceAvailable = recordsAvailable === true && Array.isArray(eaten) && eaten.every(validMeal);
  const days = datesInMonth(month).map((date) => ({
    date,
    hasActual: null,
    hasCards: null,
    issues: [],
  }));
  const due = days.filter((day) => day.date <= today);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      const day = due[index];
      if (!day) return;
      const date = day.date;
      const mealFact = hasActualInEaten(knownEaten, date, timezone, nowMs);
      let playFact = false;
      let cardsFact = false;
      let playAvailable = true;

      if (!mealSourceAvailable) {
        day.issues.push({ key: 'meals', message: '饮食记录不可读取。' });
      }
      try {
        const raw = await readStoredJson(playPath(dataDir, date));
        if (raw !== null) {
          const done = Array.isArray(raw.done) ? raw.done : [];
          playFact = raw.date === date
            && hasActualInPlay({ done: done.filter(validActivity) }, date, timezone, nowMs);
          if (raw.date !== date || !Array.isArray(raw.done) || !done.every(validActivity)) {
            throw new Error('活动记录结构无效');
          }
        }
      } catch {
        playAvailable = false;
        day.issues.push({ key: 'play', message: '活动记录损坏或不可读取。' });
      }
      try {
        const journal = await readJournal(dataDir, date);
        cardsFact = journal.cards.some((card) => card.createdAt <= nowMs
          && card.entries.every((entry) => entry.at <= nowMs));
      } catch {
        day.issues.push({ key: 'journal', message: '纪念卡记录损坏或不可读取。' });
      }

      if (mealFact || playFact) day.hasActual = true;
      else if (mealSourceAvailable && playAvailable) day.hasActual = false;
      else day.hasActual = null;
      day.hasCards = cardsFact;
      if (day.issues.some((issue) => issue.key === 'journal')) day.hasCards = null;
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, due.length) }, () => worker()));
  return { ok: true, month, today, days };
}

export { validMonth as isValidCalendarMonth };
