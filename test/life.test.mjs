/**
 * 「她的一天」内核测试：纯函数 + 临时目录里的存取。
 *
 * 不写死工具数 / 事件数 / 面板数（不变式 3）；这里只测日程自己的形状。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, report } from './harness.mjs';
import {
  DEFAULT_DAY_TYPES, DEFAULT_VOICE, TOOL_LINE, addDays, applyChange, cleanDay, clock, dateLabel, dayText, envBlock,
  findItem, isDateKey, lifeDir, listDays, momentLine, normalizeItems, normalizePlan,
  nowText, parseClock, pendingDay, pickDayType, planEventText, readDay, recentSummary,
  segmentKey, templateDay, templateItems, voiceText, weekdayOf, writeDay, zonedNow,
  cleanPlay, freeEventText, isFreeActivity, markFreeNudged, newPlay, parseSlots,
  planFreeTick, playProgress, recordPlay, skipFreeToday,
} from '../src/life/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
await mkdir(TMP_ROOT, { recursive: true });
const tmp = async () => {
  // 每个用例一个独立目录，互不干扰。不登记、不清理：理由见文件末尾。
  return mkdtemp(join(TMP_ROOT, 'life-'));
};

const TZ = 'Asia/Shanghai';
const EVENING = Date.parse('2026-11-10T19:30:00+08:00');
const MORNING = Date.parse('2026-11-10T09:30:00+08:00');
const NIGHT = Date.parse('2026-11-10T23:30:00+08:00');
const CFG = { lifeEnabled: true, lifePrecision: 'halfhour', lifeUpcoming: 3, lifeTomorrowAfter: '18:00' };

// 固定日型，不能让加权随机把「19:30 在吃晚饭」这类断言变成掷骰子。
const day = templateDay('2026-11-10', { now: EVENING, dayTypeId: 'workday', rand: () => 0 });
const tomorrow = templateDay('2026-11-11', { now: EVENING, dayTypeId: 'outing' });

test('时区：现在按 Asia/Shanghai 取，日期/时刻/星期一致', () => {
  const z = zonedNow(TZ, EVENING);
  assert.equal(z.date, '2026-11-10');
  assert.equal(z.minute, 19 * 60 + 30);
  assert.equal(z.hm, '19:30');
  assert.equal(z.weekday, 2);
  const utc = zonedNow('UTC', EVENING);
  assert.equal(utc.date, '2026-11-10');
  assert.equal(utc.minute, 11 * 60 + 30);
});

test('日期与时刻工具：跨月、24:00、非法值', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(weekdayOf('2026-11-10'), 2);
  assert.equal(parseClock('24:00'), 1440);
  assert.equal(parseClock('7:05'), 425);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock('12:60'), null);
  assert.equal(clock(1440), '24:00');
  assert.equal(clock(425), '07:05');
  assert.equal(isDateKey('2026-11-10'), true);
  assert.equal(isDateKey('2026-13-40'), false);
  assert.match(dateLabel('2026-11-10'), /11月10日 星期二/);
});

test('normalizeItems：补空档，首尾一定覆盖 00:00–24:00', () => {
  const items = normalizeItems([
    { start: '09:00', end: '12:00', activity: '上班' },
    { start: '14:00', end: '18:00', activity: '继续上班' },
  ]);
  assert.equal(items[0].start, '00:00');
  assert.equal(items.at(-1).end, '24:00');
  for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start, '中间不能有空档');
});

test('normalizeItems：重叠段被裁开，坏段被丢掉', () => {
  const items = normalizeItems([
    { start: '09:00', end: '13:00', activity: 'A' },
    { start: '11:00', end: '15:00', activity: 'B' },
    { start: 'bad', end: '16:00', activity: 'C' },
    { start: '16:00', end: '17:00', activity: '' },
  ]);
  assert.equal(items[0].start, '00:00');
  assert.ok(items.some((it) => it.activity === 'A'));
  assert.ok(items.some((it) => it.activity === 'B'));
  assert.ok(!items.some((it) => it.activity === 'C' || it.activity === ''));
  for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start);
});

test('findItem：按当前分钟落进正确的那一段', () => {
  const z = zonedNow(TZ, EVENING);
  const i = findItem(day, z.minute);
  assert.ok(i >= 0);
  assert.equal(day.items[i].activity, '吃晚饭');
  assert.equal(findItem({ items: [] }, z.minute), -1);
});

test('pickDayType：工作日 / 周末分流，指定 id 优先', () => {
  assert.equal(pickDayType(DEFAULT_DAY_TYPES, '2026-11-10', '', () => 0).id, 'workday');
  assert.equal(pickDayType(DEFAULT_DAY_TYPES, '2026-11-14', '', () => 0).id, 'restday');
  assert.equal(pickDayType(DEFAULT_DAY_TYPES, '2026-11-10', 'outing', () => 0).id, 'outing');
  assert.equal(pickDayType([], '2026-11-10', '', () => 0).id, 'workday');
});

test('模板日程：六种日型都能排满一天', () => {
  for (const type of DEFAULT_DAY_TYPES) {
    const items = templateItems(type);
    assert.equal(items[0].start, '00:00', `${type.id} 没从 00:00 开始`);
    assert.equal(items.at(-1).end, '24:00', `${type.id} 没排到 24:00`);
    for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start, `${type.id} 有空档`);
  }
});

test('applyChange：临时改主意会截断/拆开原来压在上面的段', () => {
  const items = applyChange(day.items, { start: '19:00', end: '20:00', activity: '下楼买布丁', location: '便利店' });
  assert.ok(items.some((it) => it.activity === '下楼买布丁'));
  assert.equal(items[0].start, '00:00');
  assert.equal(items.at(-1).end, '24:00');
  for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start);
  assert.throws(() => applyChange(day.items, { start: '20:00', end: '19:00', activity: 'x' }), /时间不对/);
});

test('applyChange：activity 留空 = 不做了，洞归后面那一段（不拉长前一段）', () => {
  // 上班日 18:45–19:45 吃晚饭、19:45–23:00 自己的时间；取消自己的时间 → 睡觉提前到 19:45 开始。
  const items = applyChange(day.items, { start: '19:45', end: '23:00' });
  assert.ok(!items.some((it) => it.activity === '自己的时间'), '取消掉的那段还在');
  assert.equal(items[0].start, '00:00');
  assert.equal(items.at(-1).end, '24:00');
  for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start, '取消后出现空档');
  // 关键：不能把「吃晚饭」拉成 18:45–23:00（那等于说她吃了四个钟头）。
  const dinner = items.find((it) => it.activity === '吃晚饭');
  assert.equal(dinner.end, '19:45', '取消后面的段不该把前一段无限拉长');
  assert.ok(items.find((it) => it.start === '19:45'), '洞该由后一段顶上');
});

test('applyChange：取消中间一段，洞归后一段', () => {
  // 上班日 13:00–18:00 上班里面挖 16:30–18:00 → 「下班回家」从 16:30 开始。
  const items = applyChange(day.items, { start: '16:30', end: '18:00' });
  const work = items.find((it) => it.activity === '上班' && it.start === '13:00');
  assert.equal(work.end, '16:30');
  assert.ok(items.some((it) => it.activity === '下班回家' && it.start === '16:30'), '后一段没提前开始');
  for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start);
});

test('applyChange：取消开头那一截不会让后一段顶到 00:00（不是凌晨起床）', () => {
  const items = applyChange(day.items, { start: '00:00', end: '07:30' });
  assert.equal(items[0].start, '00:00');
  assert.equal(items.at(-1).end, '24:00');
  assert.notEqual(items[0].activity, '起床洗漱、吃早饭', '后一段被拉到了 00:00，变成凌晨起床');
  assert.equal(items[0].end, '07:30', '开头那截该补一段中性的');
  assert.ok(items.find((it) => it.activity === '起床洗漱、吃早饭').start === '07:30', '原来的后一段被移动了');
});

test('applyChange：取消当天最后一段，由前一段延到 24:00', () => {
  const items = applyChange(day.items, { start: '23:00', end: '24:00' });
  assert.equal(items.at(-1).end, '24:00');
  assert.equal(items.at(-1).activity, '自己的时间', '最后一段该由前一段接上');
  for (let i = 1; i < items.length; i += 1) assert.equal(items[i - 1].end, items[i].start);
});

test('applyChange：留空 activity 但仍写错时间时，报的是时间错而不是 activity 错', () => {
  assert.throws(() => applyChange(day.items, { start: '20:00', end: '19:00' }), /时间不对/);
});

test('cleanDay：不信任外部字段，pending 不能有 items', () => {
  const dirty = cleanDay({ date: '2099-01-01', title: '  '.repeat(200), items: [{ start: 'x', end: 'y', activity: 'x' }], source: 'coo' }, '2026-11-10');
  assert.equal(dirty.date, '2026-11-10', '日期以编排方给的为准');
  assert.ok(dirty.title.length <= 60);
  assert.equal(dirty.items[0].start, '00:00');
  const p = pendingDay('2026-11-11', DEFAULT_DAY_TYPES[1], EVENING);
  assert.equal(p.source, 'pending');
  assert.equal(p.items.length, 0);
});

test('存取：写入是原子的，读回、往期、清空都按日期', async () => {
  const dataDir = await tmp();
  await writeDay(dataDir, day);
  await writeDay(dataDir, tomorrow);
  const back = await readDay(dataDir, '2026-11-10');
  assert.equal(back.items.length, day.items.length);
  assert.equal(back.dayType.name, day.dayType.name);
  assert.equal(await readDay(dataDir, '2026-11-12'), null);
  assert.deepEqual(await listDays(dataDir, 5), ['2026-11-11', '2026-11-10']);
  assert.match(lifeDir(dataDir), /feast[\\/]life$/);
  const summary = await recentSummary(dataDir, '2026-11-12', 3);
  assert.match(summary, /2026-11-11/);
  assert.match(summary, /2026-11-10/);
  const { clearDays } = await import('../src/life/store.js');
  assert.equal(await clearDays(dataDir), 2);
  assert.deepEqual(await listDays(dataDir, 5), []);
});

test('存到一半的坏文件不会让面板崩', async () => {
  const { writeFile, mkdir: mk } = await import('node:fs/promises');
  const dataDir = await tmp();
  await mk(lifeDir(dataDir), { recursive: true });
  await writeFile(join(lifeDir(dataDir), '2026-11-10.json'), '{ 坏掉的', 'utf8');
  assert.equal(await readDay(dataDir, '2026-11-10'), null);
});

test('envBlock 是低频的：同一天不同时刻完全一致（不打穿前缀缓存）', () => {
  const a = envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: EVENING });
  const b = envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: NIGHT });
  assert.equal(a, b, '傍晚之后内容不该随分钟变化');
  assert.ok(!/约 |19:30|23:30/.test(a), 'envBlock 里不能出现具体时刻');
});

test('envBlock：傍晚后才附明天，关掉就整段为空', () => {
  const before = envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: MORNING });
  const after = envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: EVENING });
  assert.ok(!before.includes('明天（'));
  assert.ok(after.includes('明天（'));
  assert.equal(envBlock({ today: day, cfg: { ...CFG, lifeEnabled: false }, tz: TZ, nowMs: EVENING }), '');
});

test('envBlock：内容里的 {{...}} 被转义，不会被当成模板变量', () => {
  const odd = templateDay('2026-11-10', { now: EVENING });
  odd.title = '把 {{代号}} 收好';
  const text = envBlock({ today: odd, cfg: CFG, tz: TZ, nowMs: MORNING });
  assert.ok(text.includes('{代号}'));
  assert.ok(!text.includes('{{'));
});

test('nowText 随时刻变化：早上和深夜说的不是一件事', () => {
  const a = nowText({ today: day, cfg: CFG, tz: TZ, nowMs: MORNING });
  const b = nowText({ today: day, cfg: CFG, tz: TZ, nowMs: NIGHT });
  assert.notEqual(a, b);
  assert.match(a, /约 09:30/);
  assert.match(b, /睡着了/);
});

test('nowText 不重复系统前缀里已有的说话方式（省上下文）', () => {
  const receipt = nowText({ today: day, cfg: CFG, tz: TZ, nowMs: MORNING });
  const prefix = envBlock({ today: day, cfg: CFG, tz: TZ, nowMs: MORNING });
  // 说话方式 / 正事优先 / 工具用法这三段都在系统前缀里；回执再贴一遍是纯重复。
  assert.ok(!receipt.includes('【怎么把这些带进聊天】'), '回执里重复了说话方式');
  assert.ok(!receipt.includes('这些只是'), '回执里重复了「正事优先」那句');
  assert.ok(!receipt.includes('她给自己记事用的'), '回执里重复了工具用法那句');
  // 但那三段在前缀里必须还在——省的是回执，不是前缀。
  assert.ok(prefix.includes('【怎么把这些带进聊天】'), '前缀里把说话方式弄丢了');
  assert.ok(prefix.includes('她给自己记事用的'), '前缀里把工具用法弄丢了');
  // 回执本身要短：只讲事实，不夹带说明。
  assert.ok(receipt.length < 260, `回执太长了（${receipt.length} 字），夹带了说明`);
});

test('momentLine：睡觉时段不推事件，别的时间给一句短的', () => {
  assert.equal(momentLine({ today: day, cfg: CFG, tz: TZ, nowMs: NIGHT }), '');
  const m = momentLine({ today: day, cfg: CFG, tz: TZ, nowMs: EVENING });
  assert.match(m, /吃晚饭/);
  assert.ok(m.length < 160, '搭车事件要短，不重复整段说话方式');
});

test('segmentKey：同一段内不变，跨段就变', () => {
  const a = segmentKey({ today: day, tz: TZ, nowMs: EVENING });
  const b = segmentKey({ today: day, tz: TZ, nowMs: EVENING + 5 * 60_000 });
  const c = segmentKey({ today: day, tz: TZ, nowMs: MORNING });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('dayText：全天时间线，空日程也有话说', () => {
  const text = dayText(day);
  assert.match(text, /00:00–/);
  assert.match(text, /24:00/);
  assert.match(text, /吃晚饭/);
  assert.match(dayText(null), /还没有日程/);
  assert.match(dayText(pendingDay('2026-11-12', DEFAULT_DAY_TYPES[1])), /还没想好/);
});

test('planEventText：写清日期、日型、饭点与交回用的工具', () => {
  const text = planEventText({ date: '2026-11-11', type: DEFAULT_DAY_TYPES[2], recent: '- 2026-11-10：上班', mealSlots: '11:30,18:00' });
  assert.match(text, /2026-11-11/);
  assert.match(text, /外出日/);
  assert.match(text, /11:30/);
  assert.match(text, /feast_life_plan/);
});

test('normalizePlan：偷懒的交回会被拦，正常的会补齐空档', () => {
  assert.throws(() => normalizePlan({ items: [] }, '2026-11-11'), /至少要写两段/);
  assert.throws(() => normalizePlan({ items: [
    { start: '09:00', end: '10:00', activity: '出门' },
    { start: '10:00', end: '11:00', activity: '' },
  ] }, '2026-11-11'), /activity/);
  const ok = normalizePlan({
    title: '去逛逛', mood: '挺高兴', dayType: 'outing',
    items: [
      { start: '00:00', end: '09:00', activity: '睡觉', location: '家' },
      { start: '09:00', end: '12:00', activity: '出门逛街', location: '市中心' },
    ],
  }, '2026-11-11');
  assert.equal(ok.date, '2026-11-11');
  assert.equal(ok.source, 'coo');
  assert.equal(ok.items.at(-1).end, '24:00');
});

test('envBlock：说清今天是自己写的、可以改、不做了也行（做决定时看得到）', () => {
  const text = envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: MORNING });
  assert.match(text, /随时可以变/, '没告诉她自己可以改');
  assert.match(text, /feast_life_adjust/, '没给出改的办法');
  assert.match(text, /留空/, '没说「不做了」怎么写');
  // 这几句是低频常量：不能因为它出现就把整段变成随时刻变化。
  assert.equal(
    envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: MORNING }),
    envBlock({ today: day, tomorrow, cfg: CFG, tz: TZ, nowMs: MORNING + 60_000 }),
  );
});

test('说话方式与工具提示指向融合后的工具名，不再提 schedule_*', () => {
  assert.match(TOOL_LINE, /feast_life_adjust/);
  assert.match(TOOL_LINE, /feast_life_view/);
  assert.match(TOOL_LINE, /feast_life_now/);
  // 「不做了」这条路要在工具提示里说清，否则她只会「改成别的事」。
  assert.match(TOOL_LINE, /留空/);
  // 也得说清过去改不了，不然她会一直试。
  assert.match(TOOL_LINE, /过去/);
  assert.match(voiceText({ lifeVoiceOn: true }), /怎么把这些带进聊天/);
  assert.ok(!`${DEFAULT_VOICE}${TOOL_LINE}`.includes('schedule_'));
  assert.equal(voiceText({ lifeVoiceOn: false }), '');
});

// --------------------------------------------------------------------------
// 自由时间（从 playtime World 并进来）
// --------------------------------------------------------------------------

test('free.parseSlots：排序、去重、认中文逗号、丢非法项', () => {
  const got = parseSlots('21:00, 10:00，10:00, 25:00, abc, 7:05');
  assert.deepEqual(got.map((s) => s.hm), ['07:05', '10:00', '21:00']);
  assert.equal(got[0].min, 425);
  assert.deepEqual(parseSlots(''), []);
  assert.deepEqual(parseSlots(null), []);
});

test('free.cleanPlay：不信任脏文件，坏条目被丢掉', () => {
  const play = cleanPlay({
    date: '2026-11-05',
    done: [{ at: 1, activity: '走走', note: 'ok' }, { at: 2, activity: '' }, null, 'x'],
    fired: { '10:00': 5, 坏键: 6 },
    pending: { slot: '10:00', since: 5, lastNudgeAt: 6, retries: 1 },
    skipped: true,
  }, '2026-11-05');
  assert.equal(play.done.length, 1, '只有一条合格的记账');
  assert.equal(play.done[0].activity, '走走');
  assert.deepEqual(Object.keys(play.fired), ['10:00'], '坏键该被丢掉');
  assert.equal(play.pending.retries, 1);
  assert.equal(play.skipped, true);
  // 空文件也给个能用的形状。
  assert.deepEqual(cleanPlay(null, '2026-11-05'), newPlay('2026-11-05'));
});

test('free.planFreeTick：到点就叫一次，同档不重复，做满就不叫', () => {
  const cfg = { lifeFreeSlots: '10:00,21:00', lifeFreeGoal: 2, lifeFreeGraceMin: 20, lifeFreeMaxRetries: 1, lifeFreeRetryMin: 40 };
  const play = newPlay('2026-11-05');
  // 10:02 到档
  let r = planFreeTick(play, cfg, { nowMs: 0, nowMin: 602 });
  assert.equal(r.action, 'fire');
  assert.equal(r.slot, '10:00');
  markFreeNudged(play, 0, '10:00');
  // 同一档再走一拍：挂了 pending，不该再 fire
  r = planFreeTick(play, cfg, { nowMs: 60_000, nowMin: 603 });
  assert.notEqual(r.action, 'fire');
});

test('free.planFreeTick：睡觉时不叫，但已经挂着的那一档照样能收尾', () => {
  const cfg = { lifeFreeSlots: '10:00', lifeFreeGoal: 3, lifeFreeGraceMin: 20, lifeFreeMaxRetries: 1, lifeFreeRetryMin: 40 };
  const play = newPlay('2026-11-05');
  assert.equal(planFreeTick(play, cfg, { nowMs: 0, nowMin: 602, asleep: true }).action, 'none',
    '睡着的时候还叫她过自己的时间');
  // 已经叫过、挂着 pending：睡觉也要能催/收尾，不能永远挂着。
  markFreeNudged(play, 0, '10:00');
  const r = planFreeTick(play, cfg, { nowMs: 41 * 60_000, nowMin: 643, asleep: true });
  assert.equal(r.action, 'retry');
});

test('free：记账、进度、跳过、跨档', () => {
  const cfg = { lifeFreeGoal: 2 };
  const play = newPlay('2026-11-05');
  assert.deepEqual(playProgress(play, 2), { done: 0, goal: 2, left: 2, reached: false });
  recordPlay(play, { nowMs: 0, activity: '出去走走', note: '看见一只猫' });
  assert.equal(play.done.length, 1);
  assert.equal(playProgress(play, 2).left, 1);
  recordPlay(play, { nowMs: 0, activity: '看了会儿视频' });
  assert.equal(playProgress(play, 2).reached, true, '做满了还说不满');
  assert.throws(() => recordPlay(play, { nowMs: 0, activity: '' }), /activity/);
  skipFreeToday(play);
  assert.equal(play.skipped, true);
  assert.equal(play.pending, null);
  // goal = 0 表示只叫不计数
  assert.equal(playProgress(play, 0).left, null);
});

test('free：只有日程说是自由段时才用「你自己的时间」这句措辞', () => {
  const play = newPlay('2026-11-05');
  const free = freeEventText({ slot: '21:00', play, cfg: { lifeFreeGoal: 3 }, where: '在家玩（家）', menu: '- 随便', freeNow: true, nowHm: '21:00' });
  assert.match(free, /你自己的时间/);
  assert.match(free, /随便/);
  const gap = freeEventText({ slot: '15:00', play, cfg: {}, where: '通勤（路上）', menu: '- 随便', freeNow: false, nowHm: '15:00' });
  assert.ok(!gap.includes('你自己的时间'), '日程说她在通勤，却告诉她「现在是你的时间」');
  assert.match(gap, /空档/);
});

test('free：日程那段本身叫「自己的时间」时，不拼出「你在自己的时间里」', () => {
  const play = newPlay('2026-11-05');
  const text = freeEventText({ slot: '21:00', play, cfg: {}, where: '自己的时间（家）', menu: '', freeNow: true });
  assert.ok(!/本来在自己的时间/.test(text), `措辞别扭：${text.split('\n')[1]}`);
  assert.match(text, /你现在在家/);
});

test('free.isFreeActivity：睡觉和上班都不算自由时间', () => {
  assert.equal(isFreeActivity({ activity: '自己的时间' }), true);
  assert.equal(isFreeActivity({ activity: '在家玩' }), true);
  assert.equal(isFreeActivity({ activity: '上班' }), false);
  assert.equal(isFreeActivity({ activity: '通勤' }), false);
  assert.equal(isFreeActivity({ activity: '睡觉' }), false);
  assert.equal(isFreeActivity(null), false);
});

await report();
// 临时目录**故意不删**：`.tmp/` 本来就在 gitignore 里，留着符合项目习惯
// （历次一次性脚本都留在那儿）。更重要的原因：测试末尾的递归删除会被沙箱
// 当成「批量删除」拦下来，`npm test` 就整个跑不完——为了一点磁盘空间不值当。
// 想清的话手动删 test/.tmp 就行。
