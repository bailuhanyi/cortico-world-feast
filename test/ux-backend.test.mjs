import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeastWorld } from '../src/world.js';
import { DEFAULTS } from '../src/config.js';
import { test, report } from './harness.mjs';

const NOW = Date.parse('2026-11-19T12:00:00+08:00');
const MONTH = '2026-11';

async function makeWorld({ dataDir, clock = { t: NOW } } = {}) {
  dataDir ??= await mkdtemp(join(tmpdir(), 'feast-ux-backend-'));
  const events = [];
  const ticks = [];
  const host = {
    log: { info() {}, warn() {}, debug() {} },
    async pushEvent(event, opts) { events.push({ ...event, opts }); return event; },
  };
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true, weatherEnabled: false, lifeWardrobeOn: false },
    dataDir, timezone: 'Asia/Shanghai', now: () => clock.t, random: () => 0.5,
    timers: { setInterval(fn) { ticks.push(fn); return ticks.length; }, clearInterval() {}, setTimeout() { return 0; } },
  });
  await world.start(host);
  return { world, ui: world.webUi('zh'), tools: Object.fromEntries(world.tools().map((tool) => [tool.name, tool.handler])), dataDir, events, clock };
}

const invoke = (ui, panel, method, args = []) => ui.invoke(panel, method, args);
const ok = (value) => { assert.equal(value.ok, true, value.message); return value; };

async function bytes(file) {
  try { return await readFile(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

test('all panels expose stable path-free viewState and today exposes calendar', async () => {
  const s = await makeWorld();
  try {
    const beforeFiles = await Promise.all([bytes(s.world.stateFile()), bytes(join(s.dataDir, 'feast', 'life', '2026-11-19.json'))]);
    const beforeEvents = s.events.length;
    const states = await Promise.all(['today', 'menu', 'combo', 'history'].map((panel) => invoke(s.ui, panel, 'viewState')));
    for (const state of states) {
      assert.deepEqual(Object.keys(state).sort(), ['date', 'ok', 'scope', 'timezone']);
      assert.equal(state.ok, true);
      assert.equal(state.date, '2026-11-19');
      assert.equal(state.timezone, 'Asia/Shanghai');
      assert.match(state.scope, /^[a-f0-9]{64}$/);
      assert.ok(!state.scope.includes(s.dataDir));
    }
    assert.equal(new Set(states.map((state) => state.scope)).size, 1);
    assert.ok(s.ui.panels.every((panel) => panel.getMethods.includes('viewState')));
    assert.ok(s.ui.panels.find((panel) => panel.id === 'today').getMethods.includes('calendar'));
    const calendar = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(calendar.month, MONTH);
    assert.equal(calendar.days.length, 30);
    assert.equal(s.events.length, beforeEvents);
    assert.deepEqual(await Promise.all([bytes(s.world.stateFile()), bytes(join(s.dataDir, 'feast', 'life', '2026-11-19.json'))]), beforeFiles);
  } finally { await s.world.stop(); }
});

test('scope is stable per World and differs for different data directories', async () => {
  const a = await makeWorld();
  const b = await makeWorld();
  try {
    const sa = ok(await invoke(a.ui, 'today', 'viewState')).scope;
    const saAgain = ok(await invoke(a.ui, 'history', 'viewState')).scope;
    const sb = ok(await invoke(b.ui, 'today', 'viewState')).scope;
    assert.equal(sa, saAgain);
    assert.notEqual(sa, sb);
    assert.notEqual(sa, a.dataDir);
    assert.notEqual(sb, b.dataDir);
  } finally { await a.world.stop(); await b.world.stop(); }
});

test('calendar cache hits, then invalidates after meal/activity/journal writes', async () => {
  const s = await makeWorld();
  try {
    const first = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(first.days.find((item) => item.date === '2026-11-19').hasActual, false);

    await writeFile(join(s.dataDir, 'feast', 'life', 'play-2026-11-19.json'), JSON.stringify({
      date: '2026-11-19', done: [{ at: NOW - 60_000, activity: '外部写入', note: '' }], fired: {}, skipped: false,
    }));
    const hit = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(hit.days.find((item) => item.date === '2026-11-19').hasActual, false, 'unchanged month is served from cache');

    await s.tools.feast_life_play({ activity: '真实活动' });
    const afterPlay = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(afterPlay.days.find((item) => item.date === '2026-11-19').hasActual, true);

    const beforeMeal = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(beforeMeal.days.find((item) => item.date === '2026-11-19').hasCards, false);
    const dish = (await invoke(s.ui, 'menu', 'list', [{ limit: 1 }])).items[0];
    const eaten = await s.tools.feast_eat({ dish: dish.id });
    assert.equal(eaten.failed, undefined, eaten.text);
    const afterMeal = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(afterMeal.days.find((item) => item.date === '2026-11-19').hasActual, true);

    ok(await invoke(s.ui, 'today', 'journal', [{ action: 'title', title: '留下这天' }]));
    const afterJournal = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(afterJournal.days.find((item) => item.date === '2026-11-19').hasCards, false, 'title alone is not a card');
    const review = ok(await invoke(s.ui, 'today', 'review', ['2026-11-19']));
    ok(await invoke(s.ui, 'today', 'journal', [{ action: 'card', selectedIds: [review.actual[0].id], title: '真实记录' }]));
    const afterCard = ok(await invoke(s.ui, 'today', 'calendar', [MONTH]));
    assert.equal(afterCard.days.find((item) => item.date === '2026-11-19').hasCards, true);
  } finally { await s.world.stop(); }
});

test('corrupt state does not block viewState and does not write on UI context read', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'feast-ux-corrupt-'));
  const stateFile = join(dataDir, 'feast', 'state.json');
  await mkdir(join(dataDir, 'feast'), { recursive: true });
  await writeFile(stateFile, '{broken-state', 'utf8');
  const before = await bytes(stateFile);
  const s = await makeWorld({ dataDir });
  try {
    for (const panel of ['today', 'menu', 'combo', 'history']) {
      assert.equal(ok(await invoke(s.ui, panel, 'viewState')).ok, true);
    }
    assert.equal(await bytes(stateFile), before);
  } finally { await s.world.stop(); }
});

test('invalid months are rejected by the UI without touching disk', async () => {
  const s = await makeWorld();
  try {
    for (const month of ['2026-1', '2026-00', '2026-13', '2026-02-30', null]) {
      const out = await invoke(s.ui, 'today', 'calendar', [month]);
      assert.equal(out.ok, false, month);
    }
  } finally { await s.world.stop(); }
});

test('calendar cache expires after 30 seconds and refreshes across midnight', async () => {
  const s = await makeWorld();
  try {
    const before = ok(await invoke(s.ui, 'today', 'calendar'));
    const file = join(s.dataDir, 'feast', 'life', 'play-2026-11-19.json');
    await writeFile(file, JSON.stringify({ date: '2026-11-19', done: [{ at: NOW, activity: '新记录' }] }));
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, false);
    s.clock.t += 30_000;
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, true);
    s.clock.t = Date.parse('2026-11-19T23:59:59+08:00');
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[19].hasActual, null);
    s.clock.t += 2000;
    const next = ok(await invoke(s.ui, 'today', 'calendar'));
    assert.equal(next.today, '2026-11-20');
    assert.equal(next.days[19].hasActual, false);
    assert.equal(before.today, '2026-11-19');
  } finally { await s.world.stop(); }
});

test('clear and restore invalidate meal and activity facts immediately', async () => {
  const s = await makeWorld();
  try {
    ok(await invoke(s.ui, 'today', 'calendar'));
    assert.notEqual((await s.tools.feast_eat({ dish: '麻婆豆腐' })).failed, true);
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, true);
    await s.ui.storage.find((item) => item.key === 'state').clear();
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, false);
    assert.notEqual((await s.tools.feast_life_play({ activity: '已经读过书' })).failed, true);
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, true);
    await s.ui.storage.find((item) => item.key === 'feast-life').clear();
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, false);
    // Restore a real activity backup through the existing recovery action.
    const file = join(s.dataDir, 'feast', 'life', 'play-2026-11-19.json');
    await writeFile(`${file}.bak`, JSON.stringify({ date: '2026-11-19', done: [{ at: NOW, activity: '恢复的事' }] }));
    ok(await invoke(s.ui, 'today', 'recovery', [{ key: 'play', action: 'restore' }]));
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, true);
    await writeFile(file, JSON.stringify({ date: '2026-11-19', done: [] }));
    ok(await invoke(s.ui, 'today', 'recovery', [{ key: 'play', action: 'reload' }]));
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar')).days[18].hasActual, false);
  } finally { await s.world.stop(); }
});

test('new eating evicts a trimmed older-month marker and keeps count totals out of facts', async () => {
  const s = await makeWorld();
  try {
    const state = JSON.parse(await bytes(s.world.stateFile()) ?? '{}');
    state.eaten = [{ id: 'retained-old', at: Date.parse('2026-10-31T12:00:00+08:00') },
      ...Array.from({ length: 199 }, (_, index) => ({ id: `meal-${index}`, at: NOW - index * 1000 }))];
    state.counts = { historicalMealWithoutRetainedRecord: 400 };
    await writeFile(s.world.stateFile(), JSON.stringify(state));
    ok(await invoke(s.ui, 'today', 'recovery', [{ key: 'state', action: 'reload' }]));
    assert.equal(ok(await invoke(s.ui, 'today', 'calendar', ['2026-10'])).days[30].hasActual, true);
    assert.notEqual((await s.tools.feast_eat({ dish: '麻婆豆腐' })).failed, true);
    const trimmed = ok(await invoke(s.ui, 'today', 'calendar', ['2026-10']));
    assert.equal(trimmed.days[30].hasActual, false);
    assert.equal(trimmed.days[29].hasActual, false);
  } finally { await s.world.stop(); }
});

test('scope is stable after restart and normalized absolute directory spelling', async () => {
  const a = await makeWorld();
  const first = ok(await invoke(a.ui, 'today', 'viewState')).scope;
  await a.world.stop();
  const b = await makeWorld({ dataDir: join(a.dataDir, '..', a.dataDir.split(/[\\/]/).at(-1), '.') });
  try { assert.equal(ok(await invoke(b.ui, 'today', 'viewState')).scope, first); }
  finally { await b.world.stop(); }
});

await report();
