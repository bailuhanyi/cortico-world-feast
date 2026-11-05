/**
 * 「陪主人吃饭」的纯逻辑测试（src/together.js）。
 *
 * 这一层不碰 fs / 定时器 / 宿主，所以断言都在"这一顿的形状和纪律"上：
 * 谁记在哪本账、一口不等于一道、邀请一天几次、三种散桌。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import {
  BACK_KEEP, BITES_KEEP, INVITE_MIN, MAX_INVITES, OWNER_ATE_KEEP, TTL_MIN,
  addBack, addBite, answerBack, biteCount, clearInvite, dropStaleInvite, finishTogether,
  inviteLeftMin, invitesToday, isTogether, makeInvite, newTogether, normalizeTogether,
  pendingBack, setOwnerAte, startTogether, togetherView, togetherWhy,
} from '../src/together.js';

const T0 = Date.parse('2026-11-05T18:00:00+08:00');
const MIN = 60_000;
const dish = (id, name = id) => ({ id, name });

test('新的一顿：默认形状是"没在吃"', () => {
  const t = newTogether();
  assert.equal(t.at, 0);
  assert.equal(isTogether(t), false);
  assert.deepEqual([t.bites, t.ownerAte, t.back], [[], [], []]);
  assert.equal(t.invite, null);
  assert.deepEqual(t.invites, { day: '', n: 0 });
  assert.equal(t.lastEnd, null);
});

test('坏数据一律洗掉，不抛：非对象、乱数组、乱 ok、乱 kind', () => {
  assert.deepEqual(normalizeTogether(null), newTogether(), 'null 给默认形状');
  assert.deepEqual(normalizeTogether('不是对象'), newTogether());
  assert.deepEqual(normalizeTogether([1, 2]), newTogether(), '数组不算对象');

  const t = normalizeTogether({
    at: 'x',
    starter: '路人',
    name: 123,
    bites: [{ id: 'a', nth: -5 }, { name: '没有 id' }, null, 'x'],
    ownerAte: [{ id: 'b' }, { note: '  啃面包  ' }, { note: '   ' }, {}],
    back: [{ id: 'c', ok: 'yes' }, { id: 'd', ok: false }],
    invite: { at: 'x' },
    invites: { day: '不是日期但是字符串', n: -3 },
    lastEnd: { at: 0, why: 'x' },
  });
  assert.equal(t.at, 0, '坏时间归 0');
  assert.equal(t.starter, '', '不认识的身份给空');
  assert.deepEqual(t.bites.map((b) => b.id), ['a'], '没有 id 的喂食记录丢掉');
  assert.equal(t.bites[0].nth, 0, '负的 nth 归 0');
  assert.deepEqual(t.ownerAte.map((e) => e.kind), ['dish', 'note'], '两种都认');
  assert.equal(t.ownerAte[1].note, '啃面包', '自由文本去空白');
  assert.equal(t.ownerAte.length, 2, '空 note 和空对象都丢掉');
  assert.deepEqual(t.back.map((g) => g.ok), [null, false], 'ok 只认布尔，别的当"还没回应"');
  assert.equal(t.invite, null, '坏的 at 不算挂着邀请');
  assert.equal(t.invites.n, 0, '负的次数归 0');
  assert.equal(t.lastEnd, null, 'at 归 0 就不算刚散过');
});

test('三本账都有上限，超了挤掉最老的', () => {
  const t = newTogether();
  startTogether(t, { nowMs: T0 });
  for (let i = 0; i < BITES_KEEP + 5; i += 1) addBite(t, { nowMs: T0 + i, dish: dish(`d${i}`), nth: i });
  assert.equal(t.bites.length, BITES_KEEP);
  assert.equal(t.bites[0].id, 'd5', '最老的被挤出去');

  for (let i = 0; i < OWNER_ATE_KEEP + 3; i += 1) setOwnerAte(t, { nowMs: T0 + i, note: `第 ${i} 口` });
  assert.equal(t.ownerAte.length, OWNER_ATE_KEEP);

  for (let i = 0; i < BACK_KEEP + 3; i += 1) addBack(t, { nowMs: T0 + i, dish: dish(`b${i}`) });
  assert.equal(t.back.length, BACK_KEEP);
});

test('开席：重置这一顿的痕迹，记住谁起的头，把挂着的邀请收掉', () => {
  const t = newTogether();
  t.bites.push({ id: 'old', name: 'old', at: T0, nth: 0 });
  t.ownerAte.push({ kind: 'note', id: '', name: '', note: '上一顿', at: T0 });
  t.back.push({ id: 'old', name: 'old', at: T0, ok: true });
  t.lastEnd = { at: T0, why: 'owner' };
  t.invite = { at: T0 };

  startTogether(t, { nowMs: T0 + MIN, starter: 'her', name: '  今晚  ' });
  assert.equal(isTogether(t), true);
  assert.equal(t.at, T0 + MIN);
  assert.equal(t.starter, 'her');
  assert.equal(t.name, '今晚', '名字去空白');
  assert.deepEqual([t.bites, t.ownerAte, t.back], [[], [], []], '上一顿的痕迹不该跟着进这一顿');
  assert.equal(t.invite, null, '人都坐下来了，邀请不必再挂');
  assert.equal(t.lastEnd, null);

  const t2 = newTogether();
  startTogether(t2, { nowMs: T0 });
  assert.equal(t2.starter, 'owner', '默认是主人起的头');
});

test('喂一口：这一顿记得住第几口，同一道喂两次算两口', () => {
  const t = newTogether();
  startTogether(t, { nowMs: T0 });
  addBite(t, { nowMs: T0 + MIN, dish: dish('mapo-tofu', '麻婆豆腐'), nth: 2 });
  addBite(t, { nowMs: T0 + 2 * MIN, dish: dish('mapo-tofu', '麻婆豆腐'), nth: 3 });
  addBite(t, { nowMs: T0 + 3 * MIN, dish: dish('zhong', '腌笃鲜'), nth: 0 });

  assert.equal(t.bites.length, 3, '喂了三口就是三条');
  assert.equal(biteCount(t, 'mapo-tofu'), 2, '同一道喂了两次');
  assert.equal(biteCount(t, 'zhong'), 1);
  assert.deepEqual(t.bites.map((b) => b.nth), [2, 3, 0], 'nth 照着记下来');
});

test('主人自己吃的：库里那道记 id，自由文本只记那句话；两样都没有就不记', () => {
  const t = newTogether();
  startTogether(t, { nowMs: T0 });

  const a = setOwnerAte(t, { nowMs: T0, dish: dish('mapo-tofu', '麻婆豆腐') });
  assert.deepEqual([a.kind, a.id, a.name], ['dish', 'mapo-tofu', '麻婆豆腐']);

  const b = setOwnerAte(t, { nowMs: T0 + MIN, note: ' 在啃面包 ' });
  assert.deepEqual([b.kind, b.note], ['note', '在啃面包']);

  assert.equal(setOwnerAte(t, { nowMs: T0 + 2 * MIN }), null, '什么都没有就不记');
  assert.equal(setOwnerAte(t, { nowMs: T0 + 2 * MIN, note: '   ' }), null, '只有空白也不记');
  assert.equal(t.ownerAte.length, 2);
});

test('回喂：只改最近那条还没回应的', () => {
  const t = newTogether();
  startTogether(t, { nowMs: T0 });
  addBack(t, { nowMs: T0, dish: dish('a', '白切鸡') });
  addBack(t, { nowMs: T0 + MIN, dish: dish('b', '东坡肉') });
  assert.equal(pendingBack(t).id, 'b', '最近那条还没回应');

  const g = answerBack(t, { ok: true });
  assert.equal(g.id, 'b');
  assert.equal(g.ok, true);
  assert.equal(pendingBack(t).id, 'a', '回应完了就轮到上一条');
  assert.equal(answerBack(t, { ok: false }).ok, false);
  assert.equal(pendingBack(t), null, '都回应完了就没有待回应的了');
  assert.equal(answerBack(t, { ok: true }), null, '没有待回应的那条时如实返回 null');
});

test('邀请：一天最多两次，第三次如实拒绝，跨天自己归零', () => {
  const day = '2026-11-05';
  const t = newTogether();

  assert.equal(invitesToday(t, day), 0);
  assert.equal(makeInvite(t, { nowMs: T0, day, max: MAX_INVITES }).ok, true);
  assert.equal(invitesToday(t, day), 1);
  assert.equal(t.invite.at, T0);

  // 同一次挂着的还没回应，再邀请就是"已经挂着"，不额外记一次
  const again = makeInvite(t, { nowMs: T0 + MIN, day, max: MAX_INVITES });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'hanging');
  assert.equal(invitesToday(t, day), 1, '"已经挂着"不该再吃掉一次名额');

  clearInvite(t);
  assert.equal(makeInvite(t, { nowMs: T0 + 2 * MIN, day, max: MAX_INVITES }).ok, true);
  clearInvite(t);
  const third = makeInvite(t, { nowMs: T0 + 3 * MIN, day, max: MAX_INVITES });
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'capped');
  assert.equal(third.used, MAX_INVITES);
  assert.equal(invitesToday(t, day), MAX_INVITES);
  assert.equal(t.invite, null, '被拒绝时不该偷偷挂上一条');

  // 第二天：自己归零，不用定时器
  const nextDay = '2026-11-06';
  assert.equal(invitesToday(t, nextDay), 0);
  assert.equal(makeInvite(t, { nowMs: T0 + 24 * 3600_000, day: nextDay, max: MAX_INVITES }).ok, true);
  assert.equal(invitesToday(t, nextDay), 1);
  assert.equal(invitesToday(t, day), 0, '换天之后前一天的账不该还算在头上');
});

test(`邀请挂 ${INVITE_MIN} 分钟就放掉，不催不发`, () => {
  const t = newTogether();
  makeInvite(t, { nowMs: T0, day: '2026-11-05' });
  assert.equal(inviteLeftMin(t, T0, INVITE_MIN), INVITE_MIN);
  assert.equal(inviteLeftMin(t, T0 + 5 * MIN, INVITE_MIN), INVITE_MIN - 5);

  assert.equal(dropStaleInvite(t, T0 + (INVITE_MIN - 1) * MIN, INVITE_MIN), false, '还没到点');
  assert.equal(Boolean(t.invite), true);
  assert.equal(inviteLeftMin(t, T0 + INVITE_MIN * MIN, INVITE_MIN), 0);
  assert.equal(dropStaleInvite(t, T0 + INVITE_MIN * MIN, INVITE_MIN), true, '到点就放掉');
  assert.equal(t.invite, null);
  assert.equal(dropStaleInvite(t, T0 + 99 * MIN, INVITE_MIN), false, '已经放掉了，不再报一次');

  // 放掉不占名额：这一天还剩一次
  const r = makeInvite(t, { nowMs: T0 + 99 * MIN, day: '2026-11-05' });
  assert.equal(r.ok, true);
  assert.equal(r.used, 2);
});

test('三种散桌：她的那份吃完 / 到点了 / 继续', () => {
  const base = { nowMs: T0 + 10 * MIN, ttlMin: TTL_MIN };

  const t1 = newTogether();
  startTogether(t1, { nowMs: T0 });
  assert.equal(togetherWhy(t1, { ...base, ateSince: 0, tableEmpty: true }), '',
    '一道都没吃掉，桌上空着也不算吃完（那可能是还没端上来）');
  assert.equal(togetherWhy(t1, { ...base, ateSince: 3, tableEmpty: false }), '', '还有菜，继续吃');
  assert.equal(togetherWhy(t1, { ...base, ateSince: 1, tableEmpty: true }), 'finished',
    '她真吃掉过、桌上也空了：吃完了');
  assert.equal(togetherWhy(t1, { ...base, ateSince: 1, tableEmpty: true, ttlMin: 9999 }), 'finished',
    '吃完优先于到点，别把"吃完了"说成"到点了"');

  const t2 = newTogether();
  startTogether(t2, { nowMs: T0 });
  assert.equal(togetherWhy(t2, { nowMs: T0 + (TTL_MIN - 1) * MIN, ttlMin: TTL_MIN }), '');
  assert.equal(togetherWhy(t2, { nowMs: T0 + TTL_MIN * MIN, ttlMin: TTL_MIN }), 'ttl');

  const t3 = newTogether();
  assert.equal(togetherWhy(t3, base), '', '本来就没在吃，没什么可散的');
});

test('散桌：at 归零、记下为什么，喂过的痕迹留着给面板回看', () => {
  const t = newTogether();
  startTogether(t, { nowMs: T0, starter: 'owner', name: '四菜一汤' });
  addBite(t, { nowMs: T0 + MIN, dish: dish('a') });
  addBack(t, { nowMs: T0 + MIN, dish: dish('b') });

  const ended = finishTogether(t, { nowMs: T0 + 20 * MIN, why: 'finished' });
  assert.deepEqual([ended.why, ended.bites, ended.back, ended.name], ['finished', 1, 1, '四菜一汤']);
  assert.equal(isTogether(t), false);
  assert.equal(t.at, 0);
  assert.equal(t.starter, '', '收摊了就不留着谁起的头');
  assert.deepEqual(t.lastEnd, { at: T0 + 20 * MIN, why: 'finished' });
  assert.equal(t.bites.length, 1, '刚才这顿喂过几口要留着回看');
  assert.equal(finishTogether(t, { nowMs: T0 + 21 * MIN, why: 'owner' }), null, '本来就没在吃：不重复散桌');
});

test('面板那一份：只给要显示的几条，但计数给全', () => {
  const t = newTogether();
  startTogether(t, { nowMs: T0, starter: 'her', name: '一起吃点' });
  for (let i = 0; i < 5; i += 1) addBite(t, { nowMs: T0 + i, dish: dish(`d${i}`, `菜${i}`), nth: i });
  for (let i = 0; i < 3; i += 1) setOwnerAte(t, { nowMs: T0 + i, note: `第 ${i} 口` });
  addBack(t, { nowMs: T0, dish: dish('x', '白切鸡') });
  addBack(t, { nowMs: T0 + MIN, dish: dish('y', '东坡肉') });

  const v = togetherView(t, { nowMs: T0 + 3 * MIN, ttlMin: TTL_MIN });
  assert.equal(v.active, true);
  assert.equal(v.starter, 'her');
  assert.equal(v.elapsedMin, 3);
  assert.equal(v.ttlMin, TTL_MIN);
  assert.equal(v.leftMin, TTL_MIN - 3);
  assert.deepEqual(v.bites.map((b) => b.name), ['菜4', '菜3', '菜2'], '最近三口，倒序');
  assert.equal(v.biteCount, 5, '计数给全，好写"喂过 5 口"');
  assert.deepEqual(v.ownerAte.map((e) => e.note), ['第 2 口', '第 1 口'], '最近两条');
  assert.deepEqual(v.back.map((g) => g.id), ['y', 'x'], '最近两条');
  assert.equal(v.backPending.id, 'y', '面板得知道哪条等着回应');
  assert.equal(v.invite, null);

  const idle = togetherView(newTogether(), { nowMs: T0 });
  assert.equal(idle.active, false);
  assert.equal(idle.elapsedMin, 0);
  assert.equal(idle.leftMin, 0);
  assert.deepEqual(idle.bites, []);
});

test('面板那一份：她挂着邀请时给剩余分钟', () => {
  const t = newTogether();
  makeInvite(t, { nowMs: T0, day: '2026-11-05', windowMin: INVITE_MIN });
  const v = togetherView(t, { nowMs: T0 + 6 * MIN, inviteWindowMin: INVITE_MIN });
  assert.equal(v.active, false);
  assert.equal(v.invite.leftMin, INVITE_MIN - 6);
  assert.ok(v.invite.at === T0);
});

await report();
