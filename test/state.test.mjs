/**
 * 状态逻辑的测试：档位解析、跨天、饭点判断、吃与反应的记账、主人的菜过期。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import {
  dayIn, eatenTodayText, eatCount, hmIn, lastEaten, markNudged, minutesIn, newState,
  nextMealText, normalizeState, parseSlots, planTick, recordEat, recordReaction, rollover,
  servedStillFresh, setServed, skipToday, statusLine,
} from '../src/state.js';

const TZ = 'Asia/Shanghai';
const at = (iso) => Date.parse(iso);
const CFG = { mealReminder: true, mealSlots: '11:30,18:00', mealGraceMin: 20, mealRetryMin: 40, mealMaxRetries: 1 };

test('档位解析：排序、去重、认中文逗号、丢掉非法项', () => {
  assert.deepEqual(parseSlots('18:00, 11:30').map((s) => s.hm), ['11:30', '18:00']);
  assert.deepEqual(parseSlots('11:30，11:30').map((s) => s.hm), ['11:30']);
  assert.deepEqual(parseSlots('25:00 7:5 07:05').map((s) => s.hm), ['07:05']);
  assert.deepEqual(parseSlots(''), []);
});

test('本地时区换算', () => {
  const t = at('2026-11-05T11:35:00+08:00');
  assert.equal(dayIn(TZ, t), '2026-11-05');
  assert.equal(hmIn(TZ, t), '11:35');
  assert.equal(minutesIn(TZ, t), 11 * 60 + 35);
});

test('跨天：饭点那套清零，吃过什么留着', () => {
  const s = newState('2026-11-04');
  s.fired['11:30'] = 1;
  s.pending = { slot: '11:30', since: 1, lastNudgeAt: 1, retries: 0 };
  s.skippedDay = '2026-11-04';
  recordEat(s, { nowMs: at('2026-11-04T12:00:00+08:00'), dish: { id: 'mapo-tofu', name: '麻婆豆腐' } });

  assert.equal(rollover(s, '2026-11-05'), true);
  assert.deepEqual(s.fired, {});
  assert.equal(s.pending, null);
  assert.equal(s.skippedDay, '');
  assert.equal(s.eaten.length, 1, '跨天把吃过的也清了就是错的');
  assert.equal(eatCount(s, 'mapo-tofu'), 1);
});

test('到点就叫（含容错）', () => {
  const s = newState('2026-11-05');
  assert.equal(planTick(s, CFG, at('2026-11-05T11:25:00+08:00'), TZ).action, 'none');
  const plan = planTick(s, CFG, at('2026-11-05T11:35:00+08:00'), TZ);
  assert.equal(plan.action, 'fire');
  assert.equal(plan.slot, '11:30');
  // 容错内
  assert.equal(planTick(newState('2026-11-05'), CFG, at('2026-11-05T11:45:00+08:00'), TZ).action, 'fire');
  // 超出容错、但今天一次都没叫过 → 补一顿
  const late = planTick(newState('2026-11-05'), CFG, at('2026-11-05T15:00:00+08:00'), TZ);
  assert.equal(late.action, 'fire');
  assert.equal(late.slot, '11:30');
  assert.equal(late.catchup, true);
});

test('叫过这一档就不再叫同一档', () => {
  const s = newState('2026-11-05');
  markNudged(s, at('2026-11-05T11:31:00+08:00'), '11:30');
  assert.equal(planTick(s, CFG, at('2026-11-05T11:35:00+08:00'), TZ).action, 'none');
  assert.equal(planTick(s, CFG, at('2026-11-05T18:05:00+08:00'), TZ).slot, '18:00');
});

test('没吃就催一次，催完放掉', () => {
  const s = newState('2026-11-05');
  markNudged(s, at('2026-11-05T11:31:00+08:00'), '11:30');
  assert.equal(planTick(s, CFG, at('2026-11-05T11:50:00+08:00'), TZ).action, 'none');
  const retry = planTick(s, CFG, at('2026-11-05T12:20:00+08:00'), TZ);
  assert.equal(retry.action, 'retry');
  markNudged(s, at('2026-11-05T12:20:00+08:00'), '11:30', true);
  assert.equal(planTick(s, CFG, at('2026-11-05T13:30:00+08:00'), TZ).action, 'drop');
});

test('吃了就把这一档收掉，不再催', () => {
  const s = newState('2026-11-05');
  markNudged(s, at('2026-11-05T11:31:00+08:00'), '11:30');
  recordEat(s, { nowMs: at('2026-11-05T11:40:00+08:00'), dish: { id: 'mapo-tofu', name: '麻婆豆腐' } });
  assert.equal(s.pending, null);
  assert.equal(planTick(s, CFG, at('2026-11-05T12:30:00+08:00'), TZ).action, 'none');
});

test('提醒关掉就完全不叫了', () => {
  const s = newState('2026-11-05');
  const off = { ...CFG, mealReminder: false };
  assert.equal(planTick(s, off, at('2026-11-05T11:35:00+08:00'), TZ).action, 'none');
  assert.equal(nextMealText(s, off, at('2026-11-05T11:35:00+08:00'), TZ), '提醒关着');
  // 档位清空也不叫
  assert.equal(planTick(s, { ...CFG, mealSlots: '' }, at('2026-11-05T11:35:00+08:00'), TZ).action, 'none');
});

test('今天不想吃：剩下的档位不再叫', () => {
  const s = newState('2026-11-05');
  skipToday(s, '2026-11-05');
  assert.equal(planTick(s, CFG, at('2026-11-05T18:05:00+08:00'), TZ).action, 'none');
  rollover(s, '2026-11-06');
  assert.equal(planTick(s, CFG, at('2026-11-06T11:35:00+08:00'), TZ).action, 'fire', '第二天该照常叫');
});

test('吃过的记录：次数累加、今天清单、最近一口', () => {
  const s = newState('2026-11-05');
  recordEat(s, { nowMs: at('2026-11-05T11:40:00+08:00'), dish: { id: 'mapo-tofu', name: '麻婆豆腐' } });
  recordEat(s, { nowMs: at('2026-11-05T12:10:00+08:00'), dish: { id: 'mapo-tofu', name: '麻婆豆腐' }, by: 'owner' });
  recordEat(s, { nowMs: at('2026-11-05T18:10:00+08:00'), dish: { id: 'tonkotsu-ramen', name: '豚骨拉面' } });
  assert.equal(eatCount(s, 'mapo-tofu'), 2);
  assert.equal(lastEaten(s).name, '豚骨拉面');
  const today = eatenTodayText(s, TZ, at('2026-11-05T19:00:00+08:00'));
  assert.ok(today.includes('11:40 麻婆豆腐'));
  assert.ok(today.includes('（主人端的）'));
  assert.equal(eatenTodayText(s, TZ, at('2026-11-06T09:00:00+08:00')), '还没吃');
});

test('反应：like/ok/dislike 三种都记得住', () => {
  const s = newState('2026-11-05');
  recordReaction(s, { nowMs: 1, id: 'mapo-tofu', name: '麻婆豆腐', liked: true, note: '麻得正好' });
  recordReaction(s, { nowMs: 2, id: 'creme-brulee', name: '焦糖布丁', liked: null });
  assert.equal(s.reactions[0].liked, true);
  assert.equal(s.reactions[1].liked, null);
  assert.throws(() => recordReaction(s, { nowMs: 3, id: '' }));
});

test('主人端来的菜会过期', () => {
  const s = newState('2026-11-05');
  const t0 = at('2026-11-05T12:00:00+08:00');
  setServed(s, { nowMs: t0, id: 'mapo-tofu' });
  assert.equal(servedStillFresh(s, t0 + 10 * 60_000, 30), true);
  assert.equal(servedStillFresh(s, t0 + 40 * 60_000, 30), false);
  assert.equal(s.served, null, '过期就该撤掉，免得半天后突然回一句');
});

test('磁盘上的坏状态被补齐，不炸', () => {
  const s = normalizeState({
    day: '2026-11-05',
    eaten: [{ id: 'x', at: 'nope' }, null, { name: '没有 id' }, { id: 'y', name: '有', at: 5, by: 'owner', miss: true }],
    counts: { x: 3, bad: -9, other: 'zz' },
    fired: { '11:30': 1, 'nonsense': 2 },
    pending: { slot: '18:00', retries: '2' },
    served: { id: 'z' },
  }, '2026-11-05');
  // 没有 id 的那条和 null 被丢掉；at 是垃圾值就归零，其余字段照留。
  assert.equal(s.eaten.length, 2);
  assert.equal(s.eaten[0].id, 'x');
  assert.equal(s.eaten[0].at, 0);
  assert.equal(s.eaten[1].by, 'owner');
  assert.equal(s.eaten[1].miss, true);
  assert.deepEqual(Object.keys(s.counts), ['x']);
  assert.deepEqual(Object.keys(s.fired), ['11:30']);
  assert.equal(s.pending.retries, 2);
  assert.equal(s.served.id, 'z');
});

test('状态页一行话把两件事都说清楚', () => {
  const s = newState('2026-11-05');
  const line = statusLine(s, CFG, at('2026-11-05T10:00:00+08:00'), TZ);
  assert.ok(line.includes('今天吃了 0 道'));
  assert.ok(line.includes('11:30'));
});

await report();
