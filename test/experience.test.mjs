/**
 * 新生活体验的真实 FeastWorld 接线：假宿主/时钟/定时器，真实工具、面板与磁盘。
 * 只运行本文件：node test/experience.test.mjs。
 * 每个夹具使用独立系统临时目录；不安装依赖、不联网、不启动真实定时器。
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, report } from './harness.mjs';
import { FeastWorld, FEAST_TOOL_DECLS } from '../src/world.js';
import { DEFAULTS } from '../src/config.js';
import { readDay, readPlay, templateDay, writeDay, writePlay } from '../src/life/index.js';

const DAY = '2026-11-05';
const PAST = '2026-11-04';
const NOON = Date.parse(`${DAY}T12:05:00+08:00`);
const DAY_MS = 86_400_000;
// 独立写下产品允许变更的范围，避免实现扩大白名单时测试也自动放行。
const STYLE_KEYS = ['mealReminder', 'mealMaxRetries', 'lifeFreeEnabled', 'lifeFreeSlots',
  'lifeFreeBusyCall', 'lifeMomentEvents', 'lifeFreeAskReport'];
const journalFile = (s, date = DAY) => join(s.dataDir, 'feast', 'journal', `${date}.json`);
const copy = (value) => structuredClone(value);

async function makeWorld({ clock = { t: NOON }, cfg = {}, dataDir, persist } = {}) {
  dataDir ??= await mkdtemp(join(tmpdir(), 'feast-experience-'));
  // 完整配置避免启动时的默认值补齐冒充本次预设的 persist 调用。
  const inputCfg = { ...DEFAULTS, enabled: true, weatherEnabled: false, lifeWardrobeOn: false, ...cfg };
  const events = [];
  const ticks = [];
  const host = {
    log: { info() {}, warn() {}, debug() {} },
    async pushEvent(event, opts) {
      events.push({ ...event, opts });
      return { ...event, cursor: events.length, origin: event.origin ?? 'external' };
    },
  };
  const world = new FeastWorld({ cfg: inputCfg, dataDir, persist, timezone: 'Asia/Shanghai',
    now: () => clock.t, random: () => 0.5,
    timers: { setInterval(fn) { ticks.push(fn); return ticks.length; }, clearInterval() {},
      setTimeout() { return 0; } },
  });
  await world.start(host);
  const ui = world.webUi('zh');
  const tools = Object.fromEntries(world.tools().map((tool) => [tool.name, tool.handler]));
  const today = (method, ...args) => ui.invoke('today', method, args);
  const menu = (method, ...args) => ui.invoke('menu', method, args);
  const runTick = async () => {
    for (const fn of ticks) await fn();
    await tools.feast_history({});
  };
  return { world, ui, tools, today, menu, dataDir, events, clock, inputCfg, runTick };
}

async function usingWorld(options, fn) {
  const s = await makeWorld(options);
  try { await fn(s); } finally { await s.world.stop(); }
}

function toolOk(out) {
  assert.notEqual(out.failed, true, out.text);
  return out;
}
function uiOk(out) {
  assert.equal(out.ok, true, out.message);
  return out;
}
async function toolJson(s, name, args) {
  return JSON.parse(toolOk(await s.tools[name](args)).text);
}
async function bytes(file) {
  try { return await readFile(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
async function journalBytes(s) {
  const file = journalFile(s);
  return [await bytes(file), await bytes(`${file}.bak`)];
}
async function recordPair(s) {
  toolOk(await s.tools.feast_eat({ dish: '麻婆豆腐' }));
  s.clock.t += 60_000;
  toolOk(await s.tools.feast_life_play({ activity: '读完两章书', note: '窗边的小猫睡着了' }));
  const review = uiOk(await s.today('review', DAY));
  assert.equal(review.actual.length, 2);
  return review.actual;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function outsideStyle(cfg) {
  return Object.fromEntries(Object.entries(cfg).filter(([key]) => !STYLE_KEYS.includes(key)));
}
function itemIds(out) { return out.items.map((item) => item.id); }
function menuLines(out) { return toolOk(out).text.split('\n').filter((line) => line.startsWith('- ')); }

// 回顾与纪念卡 ---------------------------------------------------------------

test('往期已过的计划仍只是计划，不能冒充实际或选入纪念卡', async () => {
  await usingWorld({}, async (s) => {
    const plan = templateDay(PAST, { now: NOON - DAY_MS, dayTypeId: 'restday' });
    plan.title = '计划去旧书店';
    await writeDay(s.dataDir, plan);
    const review = uiOk(await s.today('review', PAST));
    assert.equal(review.date, PAST);
    assert.equal(review.day.title, plan.title);
    assert.ok(review.day.items.length > 0);
    assert.deepEqual(review.actual, []);
    assert.deepEqual(review.issues, []);
    assert.deepEqual(review.journal, { version: 1, date: PAST, title: '', cards: [] });
    const rejected = await s.today('journal', { action: 'card', date: PAST,
      selectedIds: [review.day.items[0].id ?? review.day.items[0].activity], title: '并未去过' });
    assert.equal(rejected.ok, false);
    assert.equal(await bytes(journalFile(s, PAST)), null, '拒绝计划卡不能创建回顾档');
    const viaTool = await toolJson(s, 'feast_life_journal', { action: 'view', date: PAST });
    assert.deepEqual(viaTool.actual, []);
    assert.equal(viaTool.plan.title, plan.title);
  });
});

test('回顾现取真实饭菜和活动、稳定ID、时区与未来过滤，工具与面板一致', async () => {
  await usingWorld({}, async (s) => {
    assert.deepEqual(uiOk(await s.today('review', DAY)).actual, []);
    const first = await recordPair(s);
    assert.deepEqual(first.map(({ kind, text, hm }) => ({ kind, text, hm })), [
      { kind: 'meal', text: '麻婆豆腐', hm: '12:05' },
      { kind: 'activity', text: '读完两章书', hm: '12:06' },
    ]);
    assert.ok(first.every((entry) => typeof entry.id === 'string' && entry.id.length > 0));
    assert.equal(new Set(first.map((entry) => entry.id)).size, 2);
    const play = await readPlay(s.dataDir, DAY);
    // 用真实存储接口模拟活动源独立更新，不能依赖 World 里先前的 play 缓存。
    play.done.push({ at: NOON + 30_000, activity: '刚把花浇好', note: '' },
      { at: NOON - DAY_MS, activity: '昨天的事', note: '' },
      { at: s.clock.t + 60_000, activity: '尚未发生的事', note: '' });
    await writePlay(s.dataDir, play);
    const fresh = uiOk(await s.today('review', DAY));
    assert.deepEqual(fresh.actual.map((entry) => entry.text), ['麻婆豆腐', '刚把花浇好', '读完两章书']);
    for (const entry of first) assert.ok(fresh.actual.some((now) => now.id === entry.id));
    assert.deepEqual((await toolJson(s, 'feast_life_journal', { action: 'view', date: DAY })).actual, fresh.actual);
    assert.deepEqual(uiOk(await s.today('journal', { action: 'view', date: DAY })), fresh);
  });
});

test('手动标题独立于日程，UI和工具互相可见，清标题也不改计划', async () => {
  await usingWorld({}, async (s) => {
    const before = await bytes(join(s.world.lifeDirectory(), `${DAY}.json`));
    const count = s.events.length;
    uiOk(await s.today('journal', { action: 'title', date: DAY, title: '  小猫和热豆腐  ' }));
    assert.equal((await toolJson(s, 'feast_life_journal', { action: 'view', date: DAY })).title, '小猫和热豆腐');
    toolOk(await s.tools.feast_life_journal({ action: 'title', date: DAY, title: '工具留下的小标题' }));
    assert.equal(uiOk(await s.today('review', DAY)).journal.title, '工具留下的小标题');
    toolOk(await s.tools.feast_life_journal({ action: 'title', date: DAY, title: '   ' }));
    assert.equal(uiOk(await s.today('review', DAY)).journal.title, '');
    assert.equal(await bytes(join(s.world.lifeDirectory(), `${DAY}.json`)), before);
    assert.equal(s.events.length, count, '写回顾不能唤醒模型');
  });
});

test('保存真实快照后可导出，源记录清空与重启不丢纪念卡或独立标题', async () => {
  const s = await makeWorld();
  let restarted;
  try {
    const actual = await recordPair(s);
    const count = s.events.length;
    uiOk(await s.today('journal', { action: 'title', title: '值得留住的一天' }));
    const saved = uiOk(await s.today('journal', { action: 'card', title: '<窗边 & 热饭>',
      selectedIds: actual.map((entry) => entry.id).reverse() }));
    assert.deepEqual(saved.card.entries, actual, '卡按发生时间保存完整快照');
    const snapshot = copy(saved.card);
    const exportArgs = { action: 'export', date: DAY, cardId: snapshot.id };
    const exported = uiOk(await s.today('journal', exportArgs));
    assert.match(exported.text, /生活纪念卡.*2026-11-05/);
    assert.ok(exported.text.includes('<窗边 & 热饭>'));
    assert.ok(exported.text.includes('麻婆豆腐（吃过）'));
    assert.ok(exported.text.includes('读完两章书（窗边的小猫睡着了）'));
    assert.equal(toolOk(await s.tools.feast_life_journal(exportArgs)).text, exported.text);
    uiOk(await s.today('journal', { action: 'title', title: '后来改的小标题' }));
    assert.equal(uiOk(await s.today('review', DAY)).journal.cards[0].title, snapshot.title);
    const beforeClear = await bytes(journalFile(s));
    await s.ui.storage.find((item) => item.key === 'feast-life').clear();
    await s.ui.storage.find((item) => item.key === 'state').clear();
    const cleared = uiOk(await s.today('review', DAY));
    assert.equal(cleared.day, null);
    assert.deepEqual(cleared.actual, []);
    assert.deepEqual(cleared.journal.cards, [snapshot]);
    assert.equal(await bytes(journalFile(s)), beforeClear, '清日程与吃过记录不能触碰回顾档');
    assert.equal(uiOk(await s.today('journal', exportArgs)).text, exported.text);
    assert.equal(s.events.length, count);
    await s.world.stop();
    restarted = await makeWorld({ dataDir: s.dataDir, clock: s.clock });
    const restored = uiOk(await restarted.today('review', DAY));
    assert.equal(restored.journal.title, '后来改的小标题');
    assert.deepEqual(restored.journal.cards, [snapshot]);
    assert.equal(toolOk(await restarted.tools.feast_life_journal(exportArgs)).text, exported.text);
  } finally {
    await s.world.stop();
    await restarted?.world.stop();
  }
});

test('无效、重复、伪造与客户端自编entries在两条通路均拒绝且不改主档/备份', async () => {
  await usingWorld({}, async (s) => {
    const actual = await recordPair(s);
    uiOk(await s.today('journal', { action: 'title', title: '原有标题' }));
    uiOk(await s.today('journal', { action: 'card', selectedIds: [actual[0].id], title: '原有卡' }));
    const before = await journalBytes(s);
    const invalid = [
      { action: 'card', selectedIds: [] },
      { action: 'card', selectedIds: [actual[0].id, actual[0].id] },
      { action: 'card', selectedIds: actual.map((entry) => entry.id).concat('extra') },
      { action: 'card', selectedIds: ['invented-meal-id'] },
      { action: 'card', selectedIds: [actual[0].id], entries: [actual[0]] },
      { action: 'card', selectedIds: [actual[0].id], actual },
      { action: 'card', selectedIds: [actual[0].id], title: 'x'.repeat(61) },
      { action: 'title', title: '伪造\n换行' },
      { action: 'title', title: null },
      { action: 'title', title: 'x'.repeat(61) },
      { action: 'title', date: '2026-02-30', title: '坏日期' },
      { action: 'title', date: '../outside', title: '越界日期' },
      { action: 'card', date: '2026-11-06', selectedIds: [actual[0].id] },
      { action: 'export', cardId: 'missing-card' },
    ];
    for (const args of invalid) {
      assert.equal((await s.today('journal', args)).ok, false, JSON.stringify(args));
      assert.equal((await s.tools.feast_life_journal(args)).failed, true, JSON.stringify(args));
      assert.deepEqual(await journalBytes(s), before, '拒绝输入也不能重写备份');
    }
    await s.ui.storage.find((item) => item.key === 'state').clear();
    assert.equal((await s.today('journal', { action: 'card', selectedIds: [actual[0].id] })).ok, false,
      '页面先前拿到但源记录已移除的ID也必须拒绝');
    assert.deepEqual(await journalBytes(s), before);
  });
});

test('工具分页保留实际ID，第二页记录可直接保存并从UI导出', async () => {
  await usingWorld({}, async (s) => {
    for (let i = 0; i < 22; i += 1) {
      toolOk(await s.tools.feast_life_play({ activity: `实做的第${i + 1}件事` }));
      s.clock.t += 1000;
    }
    const first = await toolJson(s, 'feast_life_journal', { action: 'view' });
    assert.equal(first.actualTotal, 22);
    assert.equal(first.actual.length, 20);
    assert.equal(first.nextOffset, 20);
    const second = await toolJson(s, 'feast_life_journal', { action: 'view', offset: first.nextOffset });
    assert.equal(second.actual.length, 2);
    assert.equal(second.nextOffset, null);
    const all = uiOk(await s.today('review', DAY));
    assert.deepEqual([...first.actual, ...second.actual], all.actual);
    const saved = await toolJson(s, 'feast_life_journal', { action: 'card', title: '末尾的事',
      selectedIds: [second.actual[1].id] });
    assert.deepEqual(saved.card.entries, [second.actual[1]]);
    assert.ok(uiOk(await s.today('journal', { action: 'export', cardId: saved.card.id })).text.includes('第22件事'));
  });
});

for (const corruption of ['syntax', 'semantic']) {
  test(`journal ${corruption}坏档明确报issue、禁止覆盖，并可从备份恢复且保留坏档`, async () => {
    await usingWorld({}, async (s) => {
      uiOk(await s.today('journal', { action: 'title', title: '备份中的标题' }));
      uiOk(await s.today('journal', { action: 'title', title: '较新的标题' }));
      const file = journalFile(s);
      const backup = await bytes(`${file}.bak`);
      const broken = corruption === 'syntax' ? '{broken journal' : JSON.stringify({ version: 1, date: DAY, title: 7, cards: [] });
      await writeFile(file, broken, 'utf8');
      const review = uiOk(await s.today('review', DAY));
      assert.equal(review.journal, null);
      assert.ok(review.issues.some((issue) => issue.key === 'journal' && /损坏|无效/.test(issue.message)));
      const home = await s.today('list');
      assert.ok(home.storageIssues.some((issue) => issue.key === 'journal' && issue.backupAvailable));
      assert.equal((await s.today('recovery', { key: 'journal', action: 'reload' })).ok, false);
      assert.equal((await s.today('journal', { action: 'title', title: '不能盖过去' })).ok, false);
      assert.equal((await s.tools.feast_life_journal({ action: 'card', selectedIds: ['fake'] })).failed, true);
      assert.equal(await bytes(file), broken);
      assert.equal(await bytes(`${file}.bak`), backup);
      uiOk(await s.today('recovery', { key: 'journal', action: 'restore' }));
      assert.equal(uiOk(await s.today('review', DAY)).journal.title, '备份中的标题');
      const preserved = (await readdir(join(s.dataDir, 'feast', 'journal'))).filter((name) => name.startsWith(`${DAY}.json.corrupt-`));
      assert.equal(preserved.length, 1);
      assert.equal(await bytes(join(s.dataDir, 'feast', 'journal', preserved[0])), broken);
      assert.equal((await s.today('list')).storageIssues.some((issue) => issue.key === 'journal'), false);
    });
  });
}

test('journal恢复拒绝语义损坏备份，健康主档不能被坏备份替换', async () => {
  await usingWorld({}, async (s) => {
    uiOk(await s.today('journal', { action: 'title', title: '必须保住的健康主档' }));
    const file = journalFile(s);
    const before = await bytes(file);
    await writeFile(`${file}.bak`, JSON.stringify({ version: 1, date: DAY, title: '', cards: [{ id: 'broken' }] }), 'utf8');
    assert.equal((await s.today('recovery', { key: 'journal', action: 'restore' })).ok, false);
    assert.equal(await bytes(file), before, '语义坏备份被拒绝前不能替换健康主档');
    assert.equal(uiOk(await s.today('review', DAY)).journal.title, '必须保住的健康主档');
  });
});

// 提醒预设 -------------------------------------------------------------------

test('预设list/preview通路一致，预览只给七项内的实际差量且不写cfg/磁盘/事件', async () => {
  const calls = [];
  await usingWorld({ cfg: { mealMaxRetries: 2, lifeFreeBusyCall: true }, persist: (patch) => { calls.push(copy(patch)); } }, async (s) => {
    const beforeCfg = copy(s.world.cfg);
    const beforeInput = copy(s.inputCfg);
    const beforeDay = await bytes(join(s.world.lifeDirectory(), `${DAY}.json`));
    const count = s.events.length;
    const listed = uiOk(await s.today('style', { action: 'list' }));
    assert.deepEqual(listed.presets.map((preset) => preset.id), ['quiet', 'daily', 'lively']);
    assert.equal(listed.canApply, true);
    assert.deepEqual(await toolJson(s, 'feast_life_style', { action: 'list' }), listed);
    const preview = uiOk(await s.today('style', { action: 'preview', preset: 'lively' }));
    assert.deepEqual(await toolJson(s, 'feast_life_style', { action: 'preview', preset: 'lively' }), preview);
    assert.ok(Object.keys(preview.patch).length > 0);
    assert.ok(Object.keys(preview.patch).every((key) => STYLE_KEYS.includes(key)));
    assert.deepEqual(Object.keys(preview.patch).sort(), preview.changes.map((change) => change.key).sort());
    for (const { key, from, to } of preview.changes) {
      assert.equal(from, beforeCfg[key]);
      assert.equal(to, preview.patch[key]);
      assert.notEqual(from, to, '差量不应包含未变化项');
    }
    assert.match(preview.revision, /^[a-f0-9]{64}$/);
    assert.deepEqual(calls, []);
    assert.deepEqual(s.world.cfg, beforeCfg);
    assert.deepEqual(s.inputCfg, beforeInput);
    assert.equal(await bytes(join(s.world.lifeDirectory(), `${DAY}.json`)), beforeDay);
    assert.equal(s.events.length, count);
  });
});

test('apply先await宿主成功再改内存，持久cfg重启保留且工作规则/已有计划不变', async () => {
  const entered = deferred();
  const gate = deferred();
  const calls = [];
  let persisted;
  const s = await makeWorld({ cfg: { mealReminder: false, mealMaxRetries: 3, lifeFreeBusyCall: true,
    lifeDayType: 'restday', lifeGenerateAt: '23:15', mealSlots: '11:45,18:25' },
    persist: async (patch) => {
      calls.push(copy(patch));
      entered.resolve();
      await gate.promise;
      persisted = { ...persisted, ...copy(patch) };
      return { ok: true };
    },
  });
  let restarted;
  try {
    persisted = copy(s.inputCfg);
    uiOk(await s.today('workPolicy', { enabled: false }));
    const workFile = join(s.dataDir, 'feast', 'work-policy.json');
    const workBefore = await bytes(workFile);
    const dayBefore = await bytes(join(s.world.lifeDirectory(), `${DAY}.json`));
    const beforeCfg = copy(s.world.cfg);
    const beforeInput = copy(s.inputCfg);
    const count = s.events.length;
    const preview = uiOk(await s.today('style', { action: 'preview', preset: 'lively' }));
    const pending = s.today('style', { action: 'apply', preset: 'lively', revision: preview.revision });
    await entered.promise;
    assert.deepEqual(s.world.cfg, beforeCfg, 'persist未完成时运行配置不能提前变化');
    assert.deepEqual(s.inputCfg, beforeInput, '宿主原cfg对象也必须等persist成功');
    assert.deepEqual(persisted, beforeInput);
    gate.resolve();
    const applied = uiOk(await pending);
    assert.deepEqual(calls, [preview.patch]);
    assert.deepEqual(applied.changed.sort(), Object.keys(preview.patch).sort());
    assert.deepEqual(s.world.cfg, { ...beforeCfg, ...preview.patch });
    assert.deepEqual(s.inputCfg, persisted);
    assert.deepEqual(outsideStyle(s.world.cfg), outsideStyle(beforeCfg));
    assert.equal(await bytes(workFile), workBefore);
    assert.equal(await bytes(join(s.world.lifeDirectory(), `${DAY}.json`)), dayBefore);
    assert.equal(s.events.length, count);
    await s.world.stop();
    restarted = await makeWorld({ dataDir: s.dataDir, clock: s.clock, cfg: persisted });
    assert.deepEqual(restarted.world.cfg, s.world.cfg);
    assert.deepEqual(uiOk(await restarted.today('style', { action: 'preview', preset: 'lively' })).patch, {});
    assert.equal(await bytes(workFile), workBefore);
    assert.equal((await restarted.today('list')).workSchedulingEnabled, false);
  } finally {
    gate.resolve();
    await s.world.stop();
    await restarted?.world.stop();
  }
});

for (const failure of ['reject', 'false', 'ok-false']) {
  test(`异步persist ${failure}时调用前/等待中/失败后cfg都不变，可重新预览`, async () => {
    const entered = deferred();
    const gate = deferred();
    const calls = [];
    await usingWorld({ persist: async (patch) => {
      calls.push(copy(patch)); entered.resolve(); await gate.promise;
      if (failure === 'reject') throw new Error('fake disk cannot save');
      return failure === 'false' ? false : { ok: false, message: 'fake host refused' };
    } }, async (s) => {
      const before = copy(s.world.cfg);
      const beforeInput = copy(s.inputCfg);
      const count = s.events.length;
      const args = { action: 'preview', preset: 'lively' };
      const preview = await toolJson(s, 'feast_life_style', args);
      const pending = s.tools.feast_life_style({ action: 'apply', preset: 'lively', revision: preview.revision });
      await entered.promise;
      try {
        assert.deepEqual(s.world.cfg, before);
        assert.deepEqual(s.inputCfg, beforeInput);
      } finally { gate.resolve(); }
      const failed = await pending;
      assert.equal(failed.failed, true);
      assert.equal(JSON.parse(failed.text).ok, false);
      assert.deepEqual(s.world.cfg, before);
      assert.deepEqual(s.inputCfg, beforeInput);
      assert.deepEqual(calls, [preview.patch]);
      assert.equal(uiOk(await s.today('style', args)).revision, preview.revision);
      assert.equal(s.events.length, count);
    });
  });
}

test('无persist宿主可预览但UI/工具apply均失败，不能伪成功或改cfg', async () => {
  await usingWorld({}, async (s) => {
    const before = copy(s.world.cfg);
    assert.equal(uiOk(await s.today('style', { action: 'list' })).canApply, false);
    const preview = uiOk(await s.today('style', { action: 'preview', preset: 'lively' }));
    assert.equal(preview.canApply, false);
    const args = { action: 'apply', preset: 'lively', revision: preview.revision };
    assert.equal((await s.today('style', args)).ok, false);
    assert.equal((await s.tools.feast_life_style(args)).failed, true);
    assert.deepEqual(s.world.cfg, before);
    // 即使选的是当前已完全符合的预设，无保存接口也不能宣称已经保存。
    const same = uiOk(await s.today('style', { action: 'preview', preset: 'daily' }));
    assert.equal((await s.today('style', { action: 'apply', preset: 'daily', revision: same.revision })).ok, false);
  });
});

test('每个相关键变化都使旧revision失效，篡改/跨预设revision也不能persist', async () => {
  const calls = [];
  await usingWorld({ persist: (patch) => { calls.push(copy(patch)); } }, async (s) => {
    for (const key of STYLE_KEYS) {
      const preview = uiOk(await s.today('style', { action: 'preview', preset: 'lively' }));
      const original = s.world.cfg[key];
      s.world.cfg[key] = typeof original === 'boolean' ? !original : typeof original === 'number' ? original + 1 : '08:30';
      const changed = copy(s.world.cfg);
      const rejected = await s.today('style', { action: 'apply', preset: 'lively', revision: preview.revision });
      assert.equal(rejected.ok, false, key);
      assert.equal(rejected.stale, true, key);
      assert.deepEqual(s.world.cfg, changed);
      s.world.cfg[key] = original;
    }
    const preview = uiOk(await s.today('style', { action: 'preview', preset: 'lively' }));
    for (const args of [
      { action: 'apply', preset: 'lively' },
      { action: 'apply', preset: 'lively', revision: 'forged' },
      { action: 'apply', preset: 'quiet', revision: preview.revision },
      { action: 'apply', preset: '__proto__', revision: preview.revision },
    ]) {
      assert.equal((await s.tools.feast_life_style(args)).failed, true);
    }
    assert.deepEqual(calls, []);
  });
});

test('无关工作规则变化不使revision失效，UI预览能由工具应用且只保存一次差量', async () => {
  const calls = [];
  await usingWorld({ persist: async (patch) => { calls.push(copy(patch)); return true; } }, async (s) => {
    const preview = uiOk(await s.today('style', { action: 'preview', preset: 'quiet' }));
    s.world.cfg.lifeDayType = 'homebody';
    s.world.cfg.lifeGenerateAt = '23:25';
    uiOk(await s.today('workPolicy', { enabled: false }));
    const dayBefore = await readDay(s.dataDir, DAY);
    const policyBefore = await bytes(join(s.dataDir, 'feast', 'work-policy.json'));
    assert.equal(uiOk(await s.today('style', { action: 'preview', preset: 'quiet' })).revision, preview.revision);
    const applied = await toolJson(s, 'feast_life_style', { action: 'apply', preset: 'quiet', revision: preview.revision });
    assert.equal(applied.ok, true);
    assert.deepEqual(calls, [preview.patch]);
    assert.equal(s.world.cfg.lifeDayType, 'homebody');
    assert.equal(s.world.cfg.lifeGenerateAt, '23:25');
    assert.deepEqual(await readDay(s.dataDir, DAY), dayBefore);
    assert.equal(await bytes(join(s.dataDir, 'feast', 'work-policy.json')), policyBefore);
    const noChange = await toolJson(s, 'feast_life_style', { action: 'preview', preset: 'quiet' });
    assert.deepEqual(noChange.patch, {});
    uiOk(await s.today('style', { action: 'apply', preset: 'quiet', revision: noChange.revision }));
    assert.equal(calls.length, 1, '重复应用无差量不应重复写配置');
  });
});

// 菜单快捷与推荐 -------------------------------------------------------------

test('快捷all/liked/untried/recent读取真实eat/reaction，最新反馈生效且不把吃过当喜欢', async () => {
  await usingWorld({}, async (s) => {
    const all = await s.menu('list', { quick: 'all' });
    assert.ok(all.items.length > 3);
    const [liked, disliked, neutral] = all.items;
    for (const dish of [liked, disliked, neutral]) toolOk(await s.tools.feast_eat({ dish: dish.id }));
    toolOk(await s.tools.feast_reaction({ dish: liked.id, action: 'like' }));
    toolOk(await s.tools.feast_reaction({ dish: disliked.id, action: 'dislike' }));
    const before = await bytes(s.world.stateFile());
    const count = s.events.length;
    assert.deepEqual(itemIds(await s.menu('list', { quick: 'all' })), itemIds(all));
    assert.deepEqual(itemIds(await s.menu('list', { quick: 'liked' })), [liked.id]);
    const untried = itemIds(await s.menu('list', { quick: 'untried' }));
    assert.equal(untried.length, all.items.length - 3);
    for (const dish of [liked, disliked, neutral]) assert.ok(!untried.includes(dish.id));
    assert.deepEqual(new Set(itemIds(await s.menu('list', { quick: 'recent' }))), new Set([liked.id, disliked.id, neutral.id]));
    const lines = menuLines(await s.tools.feast_menu({ quick: 'liked' }));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(liked.name));
    assert.equal(await bytes(s.world.stateFile()), before);
    assert.equal(s.events.length, count);
    toolOk(await s.tools.feast_reaction({ dish: liked.id, action: 'ok' }));
    assert.deepEqual(itemIds(await s.menu('list', { quick: 'liked' })), []);
    assert.equal(menuLines(await s.tools.feast_menu({ quick: 'liked' })).length, 0);
  });
});

test('recent恰好按7天边界过滤，旧吃过仍不能进入untried，重启保持快捷结果', async () => {
  const clock = { t: NOON - 8 * DAY_MS };
  const s = await makeWorld({ clock });
  let restarted;
  try {
    const dishes = (await s.menu('list')).items.slice(0, 3);
    toolOk(await s.tools.feast_eat({ dish: dishes[0].id }));
    clock.t = NOON - 7 * DAY_MS;
    toolOk(await s.tools.feast_eat({ dish: dishes[1].id }));
    clock.t = NOON;
    toolOk(await s.tools.feast_eat({ dish: dishes[2].id }));
    const recent = itemIds(await s.menu('list', { quick: 'recent' }));
    assert.deepEqual(recent, [dishes[2].id, dishes[1].id]);
    assert.ok(!itemIds(await s.menu('list', { quick: 'untried' })).includes(dishes[0].id));
    await s.world.stop();
    restarted = await makeWorld({ dataDir: s.dataDir, clock });
    assert.deepEqual(itemIds(await restarted.menu('list', { quick: 'recent' })), recent);
    clock.t += 1;
    assert.deepEqual(itemIds(await restarted.menu('list', { quick: 'recent' })), [dishes[2].id]);
    const lines = menuLines(await restarted.tools.feast_menu({ quick: 'recent' }));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(dishes[2].name));
  } finally { await s.world.stop(); await restarted?.world.stop(); }
});

test('快捷筛选与菜系/类别/标签/搜索严格求交，推荐不越过空筛选也不伪造菜', async () => {
  await usingWorld({}, async (s) => {
    const all = (await s.menu('list')).items;
    const target = all.find((dish) => dish.keywords.length > 0);
    assert.ok(target);
    toolOk(await s.tools.feast_eat({ dish: target.id }));
    toolOk(await s.tools.feast_reaction({ dish: target.id, action: 'like' }));
    const filter = { quick: 'liked', cuisine: target.cuisine, category: target.category,
      keyword: target.keywords[0], query: target.name };
    const listed = await s.menu('list', filter);
    assert.deepEqual(itemIds(listed), [target.id]);
    const recommended = uiOk(await s.menu('recommend', { ...filter, limit: 100 }));
    assert.deepEqual(itemIds(recommended), [target.id]);
    for (const toolArgs of [filter, { ...filter, recommend: true }]) {
      const lines = menuLines(await s.tools.feast_menu(toolArgs));
      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes(target.name));
    }
    for (const mismatch of [{ cuisine: '不存在的菜系' }, { category: '不存在的类别' },
      { keyword: '绝不会匹配的标签' }, { query: '不存在的食材和菜名' }, { quick: 'untried' }]) {
      const narrow = { ...filter, ...mismatch };
      assert.deepEqual((await s.menu('list', narrow)).items, []);
      assert.deepEqual(uiOk(await s.menu('recommend', narrow)).items, []);
      assert.equal(menuLines(await s.tools.feast_menu(narrow)).length, 0);
      assert.equal(menuLines(await s.tools.feast_menu({ ...narrow, recommend: true })).length, 0);
    }
  });
});

test('推荐最多3道真实且不重复，排除讨厌、优先未尝；UI/工具读操作不记吃不push', async () => {
  await usingWorld({}, async (s) => {
    const all = (await s.menu('list')).items;
    const known = new Map(all.map((dish) => [dish.id, dish]));
    const [repeated, disliked] = all;
    toolOk(await s.tools.feast_eat({ dish: repeated.id }));
    toolOk(await s.tools.feast_eat({ dish: repeated.id }));
    toolOk(await s.tools.feast_eat({ dish: disliked.id }));
    toolOk(await s.tools.feast_reaction({ dish: disliked.id, action: 'dislike' }));
    const stateBefore = await bytes(s.world.stateFile());
    const reviewBefore = uiOk(await s.today('review', DAY));
    const count = s.events.length;
    const recommended = uiOk(await s.menu('recommend', { limit: 100 }));
    assert.equal(recommended.items.length, 3);
    assert.equal(new Set(itemIds(recommended)).size, 3);
    for (const item of recommended.items) {
      const real = known.get(item.id);
      assert.ok(real, `推荐了不存在的菜：${item.id}`);
      assert.equal(item.name, real.name);
      assert.notEqual(item.id, repeated.id, '足够未尝菜时不应推荐近期反复吃过的菜');
      assert.notEqual(item.id, disliked.id);
    }
    const viaTool = menuLines(await s.tools.feast_menu({ recommend: true }));
    assert.equal(viaTool.length, 3);
    for (const item of recommended.items) assert.ok(viaTool.some((line) => line.includes(item.name)));
    assert.deepEqual(uiOk(await s.menu('recommend', { quick: 'recent' })).items.map((dish) => dish.id), [repeated.id]);
    assert.equal(menuLines(await s.tools.feast_menu({ recommend: true, quick: 'recent' })).length, 1);
    for (const quick of ['all', 'liked', 'untried', 'recent']) {
      await s.menu('list', { quick });
      toolOk(await s.tools.feast_menu({ quick }));
    }
    assert.deepEqual(uiOk(await s.menu('recommend', { limit: 0 })).items, []);
    assert.equal(await bytes(s.world.stateFile()), stateBefore);
    assert.deepEqual(uiOk(await s.today('review', DAY)).actual, reviewBefore.actual);
    assert.equal(s.events.length, count);
  });
});

test('工具声明公开journal/style和menu快捷推荐参数，运行时handler真实可调用', async () => {
  await usingWorld({}, async (s) => {
    const declarations = Object.fromEntries(FEAST_TOOL_DECLS.map((tool) => [tool.name, tool]));
    assert.deepEqual(declarations.feast_life_journal.parameters.properties.action.enum, ['view', 'title', 'card', 'export']);
    assert.deepEqual(declarations.feast_life_style.parameters.properties.action.enum, ['list', 'preview', 'apply']);
    assert.deepEqual(declarations.feast_menu.parameters.properties.quick.enum, ['all', 'liked', 'untried', 'recent']);
    assert.equal(declarations.feast_menu.parameters.properties.recommend.type, 'boolean');
    for (const name of ['feast_life_journal', 'feast_life_style', 'feast_menu']) {
      assert.equal(typeof s.tools[name], 'function');
      assert.equal(declarations[name].parameters.additionalProperties, false);
    }
    assert.ok(s.ui.panels.find((panel) => panel.id === 'today').getMethods.includes('review'));
    assert.ok(s.ui.panels.find((panel) => panel.id === 'menu').getMethods.includes('recommend'));
  });
});

await report();
