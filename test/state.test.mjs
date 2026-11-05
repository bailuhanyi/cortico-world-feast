/**
 * 状态逻辑的测试：档位解析、跨天、饭点判断、吃与反应的记账、主人的菜过期。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import {
  dayIn, eatenMarkOf, eatenSince, eatenTodayText, eatCount, hmIn, lastEaten, markNudged, minutesIn,
  newState, nextMealText, normalizeState, parseSlots, planTick, recordEat, recordReaction, rollover,
  servedStillFresh, servedRemaining, setServed, skipToday, statusLine,
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

// --- 0.6.0：端来的从「一道」扩成「一桌」 -----------------------------------

test('端一桌：剩下的从 eaten 反推，不记递减计数器', () => {
  const s = newState('2026-11-05');
  const t0 = at('2026-11-05T12:00:00+08:00');
  setServed(s, { nowMs: t0, ids: ['a', 'b', 'c'], name: '四菜一汤', comboId: 'four-dishes-soup' });
  assert.deepEqual(servedRemaining(s), ['a', 'b', 'c']);

  // 吃一道：这一桌少一道，另外两道还在。
  recordEat(s, { nowMs: t0 + 60_000, dish: { id: 'b', name: 'b' }, by: 'owner' });
  assert.deepEqual(servedRemaining(s), ['a', 'c'], '少了一道，不是整桌收掉');
  assert.equal(servedStillFresh(s, t0 + 120_000, 30), true, '还剩两道，这一桌还在');
});

test('端一桌：点名吃桌上的菜也算进这一桌（不会重复计数）', () => {
  const s = newState('2026-11-05');
  const t0 = at('2026-11-05T12:00:00+08:00');
  setServed(s, { nowMs: t0, ids: ['a', 'b', 'c'] });
  // 她自己 named 了桌上的 b（by = 'self'），余量仍该少一道——
  // 判据是"端来之后吃过的"，不是"用哪个入口吃的"。
  recordEat(s, { nowMs: t0 + 60_000, dish: { id: 'b', name: 'b' }, by: 'self' });
  assert.deepEqual(servedRemaining(s), ['a', 'c']);
});

test('端一桌：上一顿吃过的菜不算进这一桌', () => {
  const s = newState('2026-11-05');
  const t0 = at('2026-11-05T12:00:00+08:00');
  recordEat(s, { nowMs: t0 - 60_000, dish: { id: 'a', name: 'a' } });
  setServed(s, { nowMs: t0, ids: ['a', 'b'] });
  assert.deepEqual(servedRemaining(s), ['a', 'b'], '端来之前吃的不该扣掉');
});

test('端一桌：吃完最后一道就自动收桌', () => {
  const s = newState('2026-11-05');
  const t0 = at('2026-11-05T12:00:00+08:00');
  setServed(s, { nowMs: t0, ids: ['a', 'b'] });
  recordEat(s, { nowMs: t0 + 60_000, dish: { id: 'a', name: 'a' }, by: 'owner' });
  recordEat(s, { nowMs: t0 + 120_000, dish: { id: 'b', name: 'b' }, by: 'owner' });
  assert.deepEqual(servedRemaining(s), []);
  assert.equal(servedStillFresh(s, t0 + 180_000, 30), false, '吃完了就不该再挂着');
  assert.equal(s.served, null, '整桌收掉');
});

test('端一道菜的老路径仍然照常：吃完就收', () => {
  const s = newState('2026-11-05');
  const t0 = at('2026-11-05T12:00:00+08:00');
  setServed(s, { nowMs: t0, id: 'mapo-tofu' });
  assert.deepEqual(s.served.ids, ['mapo-tofu'], '单个 id 折成 ids[0]');
  recordEat(s, { nowMs: t0 + 60_000, dish: { id: 'mapo-tofu', name: '麻婆豆腐' }, by: 'owner' });
  assert.equal(s.served, null, '一道菜吃完还是照旧收掉');
});

test('setServed 不认识的输入不会留下半张桌', () => {
  const s = newState('2026-11-05');
  setServed(s, { nowMs: 1, ids: [] });
  assert.equal(s.served, null, '空桌等于没端');
  setServed(s, { nowMs: 1, ids: ['a', 'a', ' ', 3] });
  assert.deepEqual(s.served.ids, ['a'], '去重、丢掉非字符串和空白');
});

test('旧状态文件的 served 迁移后能继续用', () => {
  const old = { day: '2026-11-05', served: { id: 'mapo-tofu', at: 1000 } };
  const s = normalizeState(old, '2026-11-05');
  assert.deepEqual(s.served.ids, ['mapo-tofu']);
  assert.equal(s.served.at, 1000);
  assert.deepEqual(servedRemaining(s), ['mapo-tofu'], '迁移完就能算出余量');
});

test('新形状的 served 也照样读得回来', () => {
  const s = normalizeState({
    day: '2026-11-05',
    served: { at: 500, ids: ['a', 'b', 'a'], name: '我的桌', comboId: 'my-table' },
  }, '2026-11-05');
  assert.deepEqual(s.served.ids, ['a', 'b'], '去重');
  assert.equal(s.served.name, '我的桌');
  assert.equal(s.served.comboId, 'my-table');
});

test('同一毫秒里端上来的菜，不会被当成「已经吃过」', () => {
  // 时钟被冻住时（测试、以及机器时钟不动的那一毫秒）端菜和吃饭的时间戳一样。
  // 用 `e.at >= served.at` 判余量的话，一桌刚摆好就显示"吃完了"。
  const t0 = at('2026-11-05T12:00:00+08:00');
  const s = newState('2026-11-05');
  recordEat(s, { nowMs: t0, dish: { id: 'a', name: 'a' } });   // 端之前就吃过 a
  setServed(s, { nowMs: t0, ids: ['a', 'b'] });                 // 同一毫秒端了含 a 的一桌
  assert.deepEqual(servedRemaining(s), ['a', 'b'], '端之前吃过的 a 不该算进这一桌');
});

test('端完一桌再端一桌，不会继承上一桌的吃完记录', () => {
  const t0 = at('2026-11-05T12:00:00+08:00');
  const s = newState('2026-11-05');
  setServed(s, { nowMs: t0, ids: ['a'] });
  recordEat(s, { nowMs: t0 + 1000, dish: { id: 'a', name: 'a' }, by: 'owner' });
  // 第二桌又有 a——刚才吃过 a，但这桌是新的，a 应该还在桌上。
  setServed(s, { nowMs: t0 + 2000, ids: ['a', 'b'] });
  assert.deepEqual(servedRemaining(s), ['a', 'b'], '新一桌不该被上一桌的吃过记录扣掉');
});

test('吃过记录被裁到上限时，余量还算得对', () => {
  const t0 = at('2026-11-05T12:00:00+08:00');
  const s = newState('2026-11-05');
  // 先灌满上限，让后来的 recordEat 真的触发裁剪。
  for (let i = 0; i < 205; i += 1) recordEat(s, { nowMs: t0 - 10_000 + i, dish: { id: `f${i}`, name: '' } });
  setServed(s, { nowMs: t0, ids: ['a', 'b', 'c'] });
  recordEat(s, { nowMs: t0 + 1000, dish: { id: 'b', name: 'b' }, by: 'owner' });
  assert.deepEqual(servedRemaining(s), ['a', 'c'], `裁剪之后余量算错了：${JSON.stringify(servedRemaining(s))}`);
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
  // 0.6.0：旧的 `{ id }` 形状要迁移成 `{ ids: [...] }`，旧状态文件必须照常能读。
  assert.deepEqual(s.served.ids, ['z'], '旧形状的 served 要迁移成 ids');
});

test('状态页一行话把两件事都说清楚', () => {
  const s = newState('2026-11-05');
  const line = statusLine(s, CFG, at('2026-11-05T10:00:00+08:00'), TZ);
  assert.ok(line.includes('今天吃了 0 道'));
  assert.ok(line.includes('11:30'));
});

// ---------------------------------------------------------------------------
// 陪主人吃饭：这一顿和"一口"的账
// ---------------------------------------------------------------------------

test('新状态就带着"没在一起吃"的那一份；没有这个字段的旧状态也补齐', () => {
  const fresh = newState('2026-11-05');
  assert.equal(fresh.together.at, 0, '默认没在吃');
  assert.deepEqual(fresh.together.bites, []);

  const old = normalizeState({ day: '2026-11-05', eaten: [] }, '2026-11-05');
  assert.equal(old.together.at, 0, '0.6.0 之前写的 state.json 里没有这个字段');
  assert.equal(old.together.invite, null);

  const bad = normalizeState({ together: '不是对象' }, '2026-11-05');
  assert.equal(bad.together.at, 0, '坏值给默认形状，不抛');

  const half = normalizeState({
    together: { at: 123, starter: 'owner', bites: [{ id: 'a', nth: 1 }, null], back: [{ id: 'b' }] },
  }, '2026-11-05');
  assert.equal(half.together.at, 123);
  assert.deepEqual(half.together.bites.map((b) => b.id), ['a']);
  assert.equal(half.together.back[0].ok, null, '没回应的回喂是"还没回应"');
});

test('喂的一口进 eaten 和 counts（所以 nth 能接着数），但不消耗桌上的菜', () => {
  const s = newState('2026-11-05');
  setServed(s, { nowMs: 1000, ids: ['mapo-tofu', 'dongpo-pork'], name: '四菜一汤' });
  const dish = { id: 'mapo-tofu', name: '麻婆豆腐' };

  const first = recordEat(s, { nowMs: 2000, dish, by: 'owner', bite: true });
  assert.equal(first.bite, true, '这一条要标出来是喂的一口');
  assert.equal(eatCount(s, 'mapo-tofu'), 1, '喂一口也算进过嘴，nth 才连得上');
  assert.deepEqual(servedRemaining(s), ['mapo-tofu', 'dongpo-pork'], '一口不等于一道：桌上不该少菜');

  const second = recordEat(s, { nowMs: 3000, dish, by: 'owner', bite: true });
  assert.equal(second.bite, true);
  assert.equal(eatCount(s, 'mapo-tofu'), 2, '同一道喂第二口，nth 接着数');

  // 真吃掉那一道（不带 bite）仍然扣减
  recordEat(s, { nowMs: 4000, dish, by: 'owner' });
  assert.deepEqual(servedRemaining(s), ['dongpo-pork'], '真吃掉一道才从桌上划掉');
  assert.equal(eatCount(s, 'mapo-tofu'), 3);
});

test('端来的只有一道时，喂一口不会把那道撤走；真吃完才撤', () => {
  const s = newState('2026-11-05');
  setServed(s, { nowMs: 1000, id: 'mapo-tofu' });
  recordEat(s, { nowMs: 2000, dish: { id: 'mapo-tofu', name: '麻婆豆腐' }, by: 'owner', bite: true });
  assert.ok(s.served, '喂一口之后这道还该在等（她只是尝了一口）');
  assert.deepEqual(servedRemaining(s), ['mapo-tofu'], '桌上还是这一道');

  recordEat(s, { nowMs: 3000, dish: { id: 'mapo-tofu', name: '麻婆豆腐' }, by: 'owner' });
  assert.equal(s.served, null, '真吃完这道就收了');
});

test('eatenSince：默认只数"真吃掉"的，喂的一口要显式要', () => {
  const s = newState('2026-11-05');
  recordEat(s, { nowMs: 5000, dish: { id: 'a', name: 'a' }, by: 'owner', bite: true });
  recordEat(s, { nowMs: 6000, dish: { id: 'a', name: 'a' }, by: 'owner' });
  recordEat(s, { nowMs: 7000, dish: { id: 'b', name: 'b' }, bite: true });

  assert.equal(eatenSince(s, 6000), 1, '这一顿开始后真吃掉了一道');
  assert.equal(eatenSince(s, 6000, { bites: true }), 2, '连喂的一口一起数就是两条');
  assert.equal(eatenSince(s, 8000), 0, '这个时间点之后什么都没吃');
});

test('吃过记录后面那个括号：喂的一口和自己的吃法分得开', () => {
  assert.equal(eatenMarkOf({ by: 'self' }), '');
  assert.equal(eatenMarkOf({ by: 'owner' }), '（主人端的）');
  assert.equal(eatenMarkOf({ by: 'owner', bite: true }), '（主人喂的一口）');
  assert.equal(eatenMarkOf({ bite: true }), '（主人喂的一口）');

  const s = newState('2026-11-05');
  const t = at('2026-11-05T12:00:00+08:00');
  recordEat(s, { nowMs: t, dish: { id: 'a', name: '麻婆豆腐' } });
  recordEat(s, { nowMs: t + 1000, dish: { id: 'b', name: '东坡肉' }, by: 'owner', bite: true });
  const text = eatenTodayText(s, TZ, t + 2000);
  assert.ok(text.includes('麻婆豆腐'), text);
  assert.ok(text.includes('东坡肉（主人喂的一口）'), text);
});

test('磁盘上的旧 eaten 记录没有 bite 字段 → 当成"自己吃掉的"，不误判成一口', () => {
  const s = normalizeState({ eaten: [{ id: 'a', name: 'a', at: 1, by: 'owner' }] }, '2026-11-05');
  assert.equal(s.eaten[0].bite, false);
  assert.equal(eatenMarkOf(s.eaten[0]), '（主人端的）', '缺字段的旧记录仍是"端的"，不是"喂的"');
});

await report();
