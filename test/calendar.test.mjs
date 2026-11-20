import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCalendarMonth } from '../src/life/calendar.js';
import { writeDay } from '../src/life/store.js';
import { test, report } from './harness.mjs';

const UTC = 'UTC';
const ms = (value) => Date.parse(value);

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'feast-calendar-'));
}

function day(out, date) {
  return out.days.find((item) => item.date === date);
}

test('strict month validation rejects malformed and impossible month strings', async () => {
  const dataDir = await tempDir();
  for (const month of ['', '2026-1', '2026-00', '2026-13', '2026-02-30', '0000-01', 202611, null]) {
    await assert.rejects(() => readCalendarMonth(dataDir, month, {
      eaten: [], recordsAvailable: true, nowMs: ms('2026-11-19T12:00:00Z'), timezone: UTC,
    }), /YYYY-MM/);
  }
});

test('month boundaries include leap day and cross the year correctly', async () => {
  const dataDir = await tempDir();
  const feb = await readCalendarMonth(dataDir, '2024-02', {
    eaten: [], recordsAvailable: true, nowMs: ms('2024-02-28T23:59:00Z'), timezone: UTC,
  });
  assert.equal(feb.days.length, 29);
  assert.equal(feb.days.at(-1).date, '2024-02-29');
  assert.equal(day(feb, '2024-02-29').hasActual, null, 'future day facts are not read or marked');
  assert.equal(day(feb, '2024-02-29').hasCards, null);

  const endOfYear = await readCalendarMonth(dataDir, '2023-12', {
    eaten: [{ id: 'retained-meal', at: ms('2023-12-31T22:00:00Z') }], recordsAvailable: true,
    nowMs: ms('2024-01-01T00:00:00Z'), timezone: UTC,
  });
  assert.equal(endOfYear.days.length, 31);
  assert.equal(endOfYear.today, '2024-01-01');
  assert.equal(day(endOfYear, '2023-12-31').hasActual, true);
  assert.equal(day(endOfYear, '2023-12-30').hasActual, false);
});

test('plans never count as actual, while only retained meal and play facts count', async () => {
  const dataDir = await tempDir();
  await writeDay(dataDir, {
    date: '2026-11-10', title: '计划去公园', items: [{ start: '09:00', end: '10:00', activity: '计划散步' }],
  });
  const out = await readCalendarMonth(dataDir, '2026-11', {
    eaten: [{ id: 'retained-meal', at: ms('2026-11-09T10:00:00Z') }], recordsAvailable: true,
    nowMs: ms('2026-11-20T12:00:00Z'), timezone: UTC,
  });
  assert.equal(day(out, '2026-11-10').hasActual, false, 'plan-only dates are not facts');
  assert.equal(day(out, '2026-11-10').hasCards, false);
  assert.equal(day(out, '2026-11-09').hasActual, true, 'retained meal fact is visible');
  assert.equal(day(out, '2026-11-08').hasActual, false, 'unrecorded day is false only when sources are readable');
});

test('damaged sources become unknown with issues; known actual still yields true', async () => {
  const dataDir = await tempDir();
  const lifeDir = join(dataDir, 'feast', 'life');
  await mkdir(lifeDir, { recursive: true });
  await mkdir(join(dataDir, 'feast', 'journal'), { recursive: true });
  await writeFile(join(lifeDir, 'play-2026-11-19.json'), '{broken', 'utf8');
  await writeFile(join(dataDir, 'feast', 'journal', '2026-11-19.json'), '{broken', 'utf8');
  const common = { recordsAvailable: true, nowMs: ms('2026-11-19T12:00:00Z'), timezone: UTC };
  const unknown = await readCalendarMonth(dataDir, '2026-11', { ...common, eaten: [] });
  assert.equal(day(unknown, '2026-11-19').hasActual, null);
  assert.equal(day(unknown, '2026-11-19').hasCards, null);
  assert.deepEqual(day(unknown, '2026-11-19').issues.map(({ key }) => key).sort(), ['journal', 'play']);

  const known = await readCalendarMonth(dataDir, '2026-11', {
    ...common, eaten: [{ id: 'retained-meal', at: ms('2026-11-19T11:00:00Z') }],
  });
  assert.equal(day(known, '2026-11-19').hasActual, true);
  assert.ok(day(known, '2026-11-19').issues.some(({ key }) => key === 'play'));
});

test('unavailable meals and unreadable play remain unknown rather than false', async () => {
  const dataDir = await tempDir();
  const lifeDir = join(dataDir, 'feast', 'life');
  await mkdir(join(lifeDir, 'play-2026-11-19.json'), { recursive: true });
  const out = await readCalendarMonth(dataDir, '2026-11', {
    eaten: [], recordsAvailable: false, nowMs: ms('2026-11-19T12:00:00Z'), timezone: UTC,
  });
  assert.equal(day(out, '2026-11-19').hasActual, null);
  assert.ok(day(out, '2026-11-19').issues.some(({ key }) => key === 'meals'));
  assert.ok(day(out, '2026-11-19').issues.some(({ key }) => key === 'play'));
});

test('future play and journal files are not read', async () => {
  const dataDir = await tempDir();
  const future = '2026-11-20';
  await mkdir(join(dataDir, 'feast', 'life', `play-${future}.json`), { recursive: true });
  await mkdir(join(dataDir, 'feast', 'journal', `${future}.json`), { recursive: true });
  const out = await readCalendarMonth(dataDir, '2026-11', {
    eaten: [], recordsAvailable: true, nowMs: ms('2026-11-19T12:00:00Z'), timezone: UTC,
  });
  assert.equal(day(out, future).hasActual, null);
  assert.equal(day(out, future).hasCards, null);
  assert.deepEqual(day(out, future).issues, []);
});

test('century leap rules and host timezones are respected', async () => {
  const dataDir = await tempDir();
  for (const [month, length] of [['1900-02', 28], ['2000-02', 29], ['2100-02', 28]]) {
    const out = await readCalendarMonth(dataDir, month, { nowMs: ms('2101-01-01T00:00:00Z'), timezone: UTC });
    assert.equal(out.days.length, length);
  }
  const out = await readCalendarMonth(dataDir, '2026-12', {
    eaten: [{ id: 'meal', at: ms('2026-11-30T16:15:00Z') }],
    nowMs: ms('2026-11-30T16:30:00Z'), timezone: 'Asia/Shanghai',
  });
  assert.equal(out.today, '2026-12-01');
  assert.equal(out.days[0].hasActual, true);
});

test('semantic play damage stays unknown; valid partial facts remain true', async () => {
  const dataDir = await tempDir();
  const dir = join(dataDir, 'feast', 'life');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'play-2026-11-19.json');
  const options = { eaten: [], nowMs: ms('2026-11-19T12:00:00Z'), timezone: UTC };
  for (const raw of [{ date: '2026-11-19', done: 'broken' },
    { date: '2026-11-19', done: [{ at: 'bad', activity: '坏时间' }] }]) {
    await writeFile(file, JSON.stringify(raw));
    const out = await readCalendarMonth(dataDir, '2026-11', options);
    assert.equal(day(out, '2026-11-19').hasActual, null);
    assert.equal(day(out, '2026-11-19').issues[0].key, 'play');
  }
  await writeFile(file, JSON.stringify({ date: '2026-11-19', done: [
    { at: ms('2026-11-19T11:00:00Z'), activity: '确实做过', note: '' }, { activity: '坏记录' },
  ] }));
  const partial = await readCalendarMonth(dataDir, '2026-11', options);
  assert.equal(day(partial, '2026-11-19').hasActual, true);
  assert.equal(day(partial, '2026-11-19').issues[0].key, 'play');
});

await report();
