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
  cleanDay, cleanMealSlots, DEFAULT_DAY_TYPES, DEFAULT_VOICE, TOOL_LINE, addDays, applyChange, clock, dateLabel, isWorkEvent, removeWorkEvents,
  dayText, envBlock, findItem, isDateKey, isWorkDayType, lifeDir, listDays, momentLine, normalizeDayTypes, categoryOf,
  normalizeItems, normalizePlan, nowText, parseClock, pendingDay, pickDayType, planEventText, readDay,
  recentSummary, segmentKey, templateDay, templateItems, voiceText, weekdayOf, writeDay, zonedNow,
  cleanPlay, classifyItem, doingsFor, freeEventText, isFreeActivity, markFreeNudged, markFreeSkipped, newPlay,
  parseDoings, parseSlots, planFreeTick, recordPlay, skipFreeToday,
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

test('normalizeItems：恰好到上限仍保留末段，超过上限明确拒绝', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    start: clock(i * 36), end: clock((i + 1) * 36), activity: `活动${i + 1}`,
  }));
  const normalized = normalizeItems(items);
  assert.equal(normalized.length, 40);
  assert.equal(normalized.at(-1).activity, '活动40');
  assert.equal(normalized.at(-1).end, '24:00');
  const tooMany = [
    ...items.slice(0, -1),
    { start: '23:24', end: '23:42', activity: '末段看书' },
    { start: '23:42', end: '24:00', activity: '睡觉' },
  ];
  const before = structuredClone(tooMany);
  assert.throws(() => normalizeItems(tooMany), (err) => err instanceof RangeError
    && err.status === 400 && err.code === 'SCHEDULE_ITEMS_LIMIT' && /41.*40.*合并/.test(err.message));
  assert.deepEqual(tooMany, before, '拒绝不能修改调用方的原计划');
  assert.throws(() => normalizePlan({ items: tooMany }, '2026-11-11'), /超过上限/);
});

test('normalizeItems：上限按修补后的全天检查，去掉重叠后可正常接收', () => {
  const partial = [{ start: '09:00', end: '12:00', activity: '看书' }];
  assert.throws(() => normalizeItems(partial, 3), /4.*3.*合并/, '首段睡觉和晚间补段也计入上限');
  const full = normalizeItems(partial, 4);
  assert.equal(full.length, 4);
  assert.equal(full[0].start, '00:00');
  assert.equal(full.at(-1).end, '24:00');
  const whole = { start: '00:00', end: '24:00', activity: '在家' };
  assert.deepEqual(normalizeItems([whole, whole, whole], 1).map((it) => it.activity), ['在家']);
  assert.equal(normalizeItems([], 1).at(-1).end, '24:00');
  for (const badMax of [0, -1, 1.5, NaN, Infinity, '2']) {
    assert.throws(() => normalizeItems([], badMax), /正整数/);
  }
});

test('applyChange：拆分后超限时明确拒绝，原始全天日程不变', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    start: clock(i * 36), end: clock((i + 1) * 36), activity: `活动${i + 1}`,
  }));
  const before = structuredClone(items);
  assert.throws(() => applyChange(items, { start: '00:10', end: '00:20', activity: '临时喝茶' }), /42.*40.*合并/);
  assert.deepEqual(items, before);
  assert.equal(items.at(-1).end, '24:00');
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

test('不上班清理：替换工作事件但保留非工作安排和原时段', () => {
  const source = [
    { start: '08:00', end: '09:00', activity: '通勤', location: '路上' },
    { start: '09:00', end: '12:00', activity: '在办公室开会', location: '公司' },
    { start: '12:00', end: '13:00', activity: '吃午饭', location: '公司附近' },
    { start: '13:00', end: '17:00', activity: '工作室画画', location: '工作室' },
  ];
  assert.equal(isWorkEvent(source[0]), true);
  assert.equal(isWorkEvent(source[1]), true);
  assert.equal(isWorkEvent(source[2]), false);
  assert.equal(isWorkEvent(source[3]), false);
  for (const activity of ['公司附近吃饭', '下班后去看电影', '不上班，在家看书', '工作室画画', '去公司附近的书店']) {
    assert.equal(isWorkEvent({ activity }), false, activity);
  }
  for (const activity of ['上班（偷偷摸鱼）', '下班回家', '在公司', '在家办公', '通勤']) {
    assert.equal(isWorkEvent({ activity }), true, activity);
  }
  const cleaned = removeWorkEvents(source);
  assert.deepEqual(cleaned.map((item) => [item.start, item.end]), source.map((item) => [item.start, item.end]));
  assert.deepEqual(cleaned.map((item) => item.activity), ['自由安排', '自由安排', '吃午饭', '工作室画画']);
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

// --------------------------------------------------------------------------
// 0.10.0：她可以自己定「今天上不上班」和「几点吃」
// --------------------------------------------------------------------------

test('cleanMealSlots：排序、去重、认中文逗号，最多 4 档，坏值丢掉而不是整份作废', () => {
  assert.deepEqual(cleanMealSlots(['19:00', '12:10', '12:10']), ['12:10', '19:00']);
  assert.deepEqual(cleanMealSlots('7:05，18:00 25:00 abc'), ['07:05', '18:00']);
  assert.deepEqual(cleanMealSlots(['08:00', '11:00', '14:00', '18:00', '21:00']),
    ['08:00', '11:00', '14:00', '18:00'], '超过 4 档要截住');
  assert.deepEqual(cleanMealSlots([]), []);
  assert.deepEqual(cleanMealSlots(null), []);
  assert.deepEqual(cleanMealSlots(['乱写']), [], '整份都坏时给空数组，由调用方退回兜底');
});

test('isWorkDayType：上班日/加班日/摸鱼日算上班，其余不算', () => {
  assert.equal(isWorkDayType('workday'), true);
  assert.equal(isWorkDayType('overtime'), true);
  assert.equal(isWorkDayType('slacking'), true);
  assert.equal(isWorkDayType('restday'), false);
  assert.equal(isWorkDayType('outing'), false);
  assert.equal(isWorkDayType({ id: 'workday' }), true);
  assert.equal(isWorkDayType(null), false);
});

test('pickDayType：说了不上班就只在不上班的日型里挑，说了上班同理', () => {
  // 2026-11-05 是周四（工作日）。明确说不上班时**不能**因为休息日标着周末就挑不到。
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const off = pickDayType(DEFAULT_DAY_TYPES, '2026-11-05', '', () => r, false);
    assert.equal(isWorkDayType(off), false, `rand=${r} 挑成了 ${off.name}`);
    const on = pickDayType(DEFAULT_DAY_TYPES, '2026-11-05', '', () => r, true);
    assert.equal(isWorkDayType(on), true, `rand=${r} 挑成了 ${on.name}`);
  }
  // 没指定时仍按星期分流（周四 → 上班日那一侧）。
  const byWeekday = pickDayType(DEFAULT_DAY_TYPES, '2026-11-05', '', () => 0);
  assert.equal(isWorkDayType(byWeekday), true);
});

test('pickDayType：这一类被关光了也不悄悄给回上班日', () => {
  const types = normalizeDayTypes(DEFAULT_DAY_TYPES.map((t) => (
    isWorkDayType(t) ? { ...t, enabled: false } : t
  )));
  const picked = pickDayType(types, '2026-11-05', '', () => 0, false);
  assert.equal(isWorkDayType(picked), false);
});

test('cleanDay：标记和日型对不上时以标记为准（说不上班就不该还写着通勤）', () => {
  const off = cleanDay({ ...day, work: false }, '2026-11-10', { rand: () => 0 });
  assert.equal(off.work, false);
  assert.equal(isWorkDayType(off.dayType), false, `还挑成了 ${off.dayType.name}`);

  const back = cleanDay({ ...off, work: true }, '2026-11-10', { rand: () => 0 });
  assert.equal(back.work, true);
  assert.equal(isWorkDayType(back.dayType), true);

  // 不写 work 时按日型推：老日程文件没有这个字段也照常能读。
  const legacy = cleanDay({ items: day.items, dayType: 'restday' }, '2026-11-10');
  assert.equal(legacy.work, false);
  assert.deepEqual(legacy.mealSlots, [], '老文件没有 mealSlots = 她没定');
});

test('templateDay：能按她说的上不上班和饭点造兜底的一天', () => {
  const off = templateDay('2026-11-05', { now: EVENING, work: false, mealSlots: ['12:30'], rand: () => 0 });
  assert.equal(off.work, false);
  assert.equal(isWorkDayType(off.dayType), false);
  assert.deepEqual(off.mealSlots, ['12:30']);
});

test('存取：她定的饭点和上班标记跟着日程一起落盘、读回', async () => {
  const dataDir = await tmp();
  const written = cleanDay({ ...day, work: false, mealSlots: ['12:30', '19:40'] }, '2026-11-10', { rand: () => 0 });
  await writeDay(dataDir, written);
  const back = await readDay(dataDir, '2026-11-10');
  assert.deepEqual(back.mealSlots, ['12:30', '19:40']);
  assert.equal(back.work, false);
});


test('存到一半的坏文件明确报错并保留原文件', async () => {
  const { writeFile, readFile, mkdir: mk } = await import('node:fs/promises');
  const dataDir = await tmp();
  await mk(lifeDir(dataDir), { recursive: true });
  const file = join(lifeDir(dataDir), '2026-11-10.json');
  await writeFile(file, '{ 坏掉的', 'utf8');
  await assert.rejects(readDay(dataDir, '2026-11-10'), /记录损坏/);
  assert.equal(await readFile(file, 'utf8'), '{ 坏掉的');
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
  assert.ok(prefix.includes('feast_life_adjust'), '前缀里把工具用法弄丢了');
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

test('free.cleanPlay：不信任脏文件；老文件里的 pending 认了但不带走', () => {
  const play = cleanPlay({
    date: '2026-11-05',
    done: [{ at: 1, activity: '走走', note: 'ok' }, { at: 2, activity: '' }, null, 'x'],
    fired: { '10:00': 5, 坏键: 6 },
    pending: { slot: '10:00', since: 5, lastNudgeAt: 6, retries: 1 },
    skippedSlots: { '14:00': { at: 7, doing: '上班' }, 补: { at: 8, doing: '开会' }, 坏键: {} },
    skipped: true,
  }, '2026-11-05');
  assert.equal(play.done.length, 1, '只有一条合格的记账');
  assert.equal(play.done[0].activity, '走走');
  assert.deepEqual(Object.keys(play.fired), ['10:00'], '坏键该被丢掉');
  // 0.8.0 起没有 pending（不再催）：老文件里的字段读进来就丢掉，不迁移也不会炸。
  assert.equal(play.pending, undefined);
  assert.deepEqual(Object.keys(play.skippedSlots), ['14:00', '补'], '「补」那一档也要能读回来');
  assert.equal(play.skippedSlots['14:00'].doing, '上班');
  assert.equal(play.skipped, true);
  // 空文件也给个能用的形状。
  assert.deepEqual(cleanPlay(null, '2026-11-05'), newPlay('2026-11-05'));
});

test('kind.classifyItem：睡觉优先、上班算占用、其余算她的空档', () => {
  assert.equal(classifyItem(null), 'none');
  assert.equal(classifyItem({ activity: '   ' }), 'none');
  assert.equal(classifyItem('回笼觉'), 'asleep', '字符串入参也认（老调用点传过）');
  assert.equal(classifyItem({ activity: '午睡' }), 'asleep');
  assert.equal(classifyItem({ activity: '打盹' }), 'asleep');
  assert.equal(classifyItem({ activity: '上班（偷偷摸鱼）' }), 'busy');
  assert.equal(classifyItem({ activity: '通勤' }), 'busy');
  assert.equal(classifyItem({ activity: '开会' }), 'busy');
  // 睡着也算占用，但睡要优先：不能把「午睡」说成 busy 去报备。
  assert.equal(classifyItem({ activity: '午睡' }), 'asleep');
  assert.equal(classifyItem({ activity: '刷手机' }), 'free');
  assert.equal(classifyItem({ activity: '窗边发呆' }), 'free');
  assert.equal(classifyItem({ activity: '自己的时间' }), 'free');
});

test('kind.classifyItem：睡前、否定睡觉和工作室地点不误判，保留真正的睡忙词', () => {
  for (const activity of ['睡前看书', '不睡了喝茶', '不想睡觉，刷手机', '睡醒后喝茶', '睡不着看书', '工作室画画', '在工作室画画']) {
    assert.equal(classifyItem(activity), 'free', activity);
    assert.equal(isFreeActivity({ activity }), true, activity);
  }
  for (const activity of ['睡觉', '午睡', '回笼觉', '补觉', '午觉', '小憩', '眯一会儿', '赖床', '睡前看书后睡觉', '工作室午睡']) {
    assert.equal(classifyItem(activity), 'asleep', activity);
  }
  for (const activity of ['上班（偷偷摸鱼）', '工作', '办公', '工作室加班', '不睡了赶稿', '睡前开会', '在工作室工作']) {
    assert.equal(classifyItem(activity), 'busy', activity);
  }
});

test('free.planFreeTick：到点叫一次，同一档不重复；过了容错就当错过', () => {
  const cfg = { lifeFreeSlots: '10:00,21:00', lifeFreeGraceMin: 20 };
  const play = newPlay('2026-11-05');
  let r = planFreeTick(play, cfg, { nowMin: 602, kind: 'free' });
  assert.deepEqual([r.action, r.slot], ['fire', '10:00']);
  markFreeNudged(play, 0, '10:00');
  // 同一档再走一拍：不再 fire，也不催。
  r = planFreeTick(play, cfg, { nowMin: 603, kind: 'free' });
  assert.equal(r.action, 'none');
  // 容错窗口过了（10:40）也不再补叫这一档——下一档就是下一档。
  r = planFreeTick(play, cfg, { nowMin: 640, kind: 'free' });
  assert.equal(r.action, 'none');
});

test('free.planFreeTick：积压档位合并到最近一档，保存后不会连续补发', () => {
  const cfg = { lifeFreeSlots: '10:00,10:05,10:10,11:00', lifeFreeGraceMin: 20 };
  const play = newPlay('2026-11-05');
  const plan = planFreeTick(play, cfg, { nowMin: 610, kind: 'free' });
  assert.equal(plan.slot, '10:10');
  assert.deepEqual(plan.mergedSlots, ['10:00', '10:05']);
  assert.deepEqual(play.fired, {});
  markFreeNudged(play, 1, plan.slot, plan.mergedSlots);
  const restored = cleanPlay(JSON.parse(JSON.stringify(play)), play.date);
  assert.deepEqual(Object.keys(restored.fired).sort(), ['10:00', '10:05', '10:10']);
  assert.equal(planFreeTick(restored, cfg, { nowMin: 611, kind: 'free' }).action, 'none');
  assert.equal(planFreeTick(restored, cfg, { nowMin: 660, kind: 'free' }).slot, '11:00');
});

test('free.planFreeTick：睡醒后才合并档位，忙时跳过也处理全部积压档位', () => {
  const cfg = { lifeFreeSlots: '10:00,10:05,10:10', lifeFreeGraceMin: 20 };
  const play = newPlay('2026-11-05');
  assert.equal(planFreeTick(play, cfg, { nowMin: 610, kind: 'asleep' }).action, 'none');
  assert.deepEqual(play.fired, {});
  const plan = planFreeTick(play, cfg, { nowMin: 612, kind: 'busy' });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.slot, '10:10');
  markFreeSkipped(play, 1, plan.slot, '上班', plan.mergedSlots);
  assert.deepEqual(Object.keys(play.skippedSlots).sort(), ['10:00', '10:05', '10:10']);
  assert.equal(planFreeTick(play, cfg, { nowMin: 613, kind: 'free' }).action, 'none');
});

test('free.planFreeTick：合并不包含已处理档位或窗口外档位，零时刻记录仍有效', () => {
  const cfg = { lifeFreeSlots: '09:00,10:00,10:05,10:10', lifeFreeGraceMin: 20 };
  const play = newPlay('2026-11-05');
  markFreeNudged(play, 0, '10:05');
  const plan = planFreeTick(play, cfg, { nowMin: 610, kind: 'free' });
  assert.equal(plan.slot, '10:10');
  assert.deepEqual(plan.mergedSlots, ['10:00']);
  markFreeNudged(play, 1, plan.slot, plan.mergedSlots);
  assert.equal(play.fired['10:05'], 0);
  assert.ok(!('09:00' in play.fired));
  assert.equal(planFreeTick(play, cfg, { nowMin: 611, kind: 'free' }).action, 'none');
});

test('free.planFreeTick：睡觉不叫，也不把这一档记成已处理', () => {
  const cfg = { lifeFreeSlots: '10:00', lifeFreeGraceMin: 20 };
  const play = newPlay('2026-11-05');
  assert.equal(planFreeTick(play, cfg, { nowMin: 602, kind: 'asleep' }).action, 'none',
    '睡着的时候还叫她过自己的时间');
  assert.deepEqual(play.fired, {}, '睡着了不该吃掉这一档：醒了还在容错窗口里就该能叫');
});

test('free.planFreeTick：忙着时默认跳过，开了 lifeFreeBusyCall 才叫', () => {
  const cfg = { lifeFreeSlots: '10:00', lifeFreeGraceMin: 20 };
  const play = newPlay('2026-11-05');
  const skip = planFreeTick(play, cfg, { nowMin: 602, kind: 'busy' });
  assert.deepEqual([skip.action, skip.slot], ['skip', '10:00']);
  const fire = planFreeTick(play, { ...cfg, lifeFreeBusyCall: true }, { nowMin: 602, kind: 'busy' });
  assert.deepEqual([fire.action, fire.slot, fire.kind], ['fire', '10:00', 'busy']);
});

test('free：记账、跳过、忙时留痕', () => {
  const play = newPlay('2026-11-05');
  recordPlay(play, { nowMs: 0, activity: '出去走走', note: '看见一只猫' });
  assert.equal(play.done.length, 1);
  recordPlay(play, { nowMs: 0, activity: '看了会儿视频' });
  assert.equal(play.done.length, 2);
  assert.throws(() => recordPlay(play, { nowMs: 0, activity: '' }), /activity/);
  skipFreeToday(play);
  assert.equal(play.skipped, true);
  assert.equal(planFreeTick(play, { lifeFreeSlots: '21:00' }, { nowMin: 1262, kind: 'free' }).action, 'none');

  // 忙时跳过要留痕（面板据此解释「为什么没叫」），并记成已处理，免得每拍重判。
  const p2 = newPlay('2026-11-05');
  markFreeSkipped(p2, 1, '10:00', '上班（公司）');
  assert.equal(p2.fired['10:00'], 1);
  assert.equal(p2.skippedSlots['10:00'].doing, '上班（公司）');
});

test('free.planFreeTick：今天一档都没处理过时补一档（应用下午才开）', () => {
  const fresh = newPlay('2026-11-05');
  const r = planFreeTick(fresh, { lifeFreeSlots: '10:00,21:00', lifeFreeGraceMin: 20 }, { nowMin: 900, kind: 'free' });
  assert.deepEqual([r.action, r.slot], ['fire', '补']);
});

test('free：只有日程说是空档时才用「你自己的时间」这句措辞', () => {
  const play = newPlay('2026-11-05');
  const free = freeEventText({ slot: '21:00', kind: 'free', play, cfg: {}, where: '在家玩（家）', menu: '- 随便', nowHm: '21:00' });
  assert.match(free, /你自己的时间/);
  assert.match(free, /随便/);
  // 没有日程（空档）：还是给例子，但不说「就是你的时间」。
  const gap = freeEventText({ slot: '15:00', kind: 'none', play, cfg: {}, where: '', menu: '- 随便', nowHm: '15:00' });
  assert.ok(!gap.includes('你自己的时间'), '没有日程却说「现在是你的时间」');
  assert.match(gap, /空档/);
});

test('free：忙着时只说报备，不说「这是你的时间」，也不贴出门的例子', () => {
  const play = newPlay('2026-11-05');
  recordPlay(play, { nowMs: Date.parse('2026-11-05T10:02:00+08:00'), activity: '出去走走' });
  const busy = freeEventText({
    slot: '10:30', kind: 'busy', play, cfg: { lifeFreeAskReport: false },
    where: '上班（公司）', menu: '- 出去转转', nowHm: '10:30',
  });
  assert.ok(!busy.includes('你自己的时间'), '忙着的时候不能说「这是你的时间」');
  assert.match(busy, /这会儿你在上班/);
  assert.match(busy, /feast_life_play/, '还是得说怎么记一笔');
  assert.ok(!busy.includes('出去转转'), '忙时不该贴出门的例子');
  assert.ok(!busy.includes('跟主人说一句'), 'askReport 关着却提醒了');
});

test('free：日程那段本身叫「自己的时间」时，不拼出「你在自己的时间里」', () => {
  const play = newPlay('2026-11-05');
  const text = freeEventText({ slot: '21:00', kind: 'free', play, cfg: {}, where: '自己的时间（家）', menu: '' });
  assert.ok(!/本来在自己的时间/.test(text), `措辞别扭：${text.split('\n')[1]}`);
  assert.match(text, /你现在在家/);
});

// --------------------------------------------------------------------------
// 能做的事（lifeDoings）
// --------------------------------------------------------------------------

test('doings：按日型分节，认名字也认 id；没写日型的算通用', () => {
  const all = parseDoings([
    '- 睡到自然醒，起来泡杯茶',
    '上班日：',
    '- 在公司写方案，被叫去开会',
    '- 午休找主人聊两句（qq 发消息）',
    'restday:',
    '* 追番（bvp_watch_now mode="text"）',
    '1. 下楼买菜，顺手发条空间动态',
  ].join('\n'));
  assert.deepEqual(doingsFor(all, { id: 'workday', name: '上班日' }), [
    '在公司写方案，被叫去开会',
    '午休找主人聊两句（qq 发消息）',
  ]);
  assert.deepEqual(doingsFor(all, { id: 'restday', name: '休息日' }), [
    '追番（bvp_watch_now mode="text"）',
    '下楼买菜，顺手发条空间动态',
  ]);
  // 没有专属节就退回通用那一份。
  assert.deepEqual(doingsFor(all, { id: 'outing', name: '外出日' }), ['睡到自然醒，起来泡杯茶']);
  // 没配就是空，跟以前一样由她自己编。
  assert.deepEqual(doingsFor(parseDoings(''), { id: 'workday', name: '上班日' }), []);
});

test('doings：一块进「请她写明天」的正文；没配就整段不出现', () => {
  const type = { id: 'restday', name: '休息日', guide: '不上班，在家待着。' };
  const plain = planEventText({ date: '2026-11-06', type });
  assert.ok(!plain.includes('你手边真能做的事'), '没配清单却出现了那一段');

  const withDoings = planEventText({ date: '2026-11-06', type, doings: ['追番（bvp_watch_now mode="text"）'] });
  assert.match(withDoings, /你手边真能做的事/);
  assert.match(withDoings, /bvp_watch_now/);
  assert.match(withDoings, /不是任务/, '清单得说清不是任务');
  // 清单在日型之后、最近几天之前。
  assert.ok(withDoings.indexOf('你手边真能做的事') > withDoings.indexOf('这一天按'));
});

test('free.isFreeActivity：睡觉和上班都不算自由时间', () => {
  assert.equal(isFreeActivity({ activity: '自己的时间' }), true);
  assert.equal(isFreeActivity({ activity: '在家玩' }), true);
  assert.equal(isFreeActivity({ activity: '上班' }), false);
  assert.equal(isFreeActivity({ activity: '通勤' }), false);
  assert.equal(isFreeActivity({ activity: '睡觉' }), false);
  assert.equal(isFreeActivity(null), false);
});

test('分类与提醒分离：个人活动仍可忙碌，睡眠不被分类绕过，否定上班不算忙', () => {
  for (const category of [undefined, 'personal', 'meal', 'work']) {
    assert.equal(classifyItem({ activity: '午睡', category }), 'asleep');
  }
  assert.equal(classifyItem({ activity: '上课', category: 'personal' }), 'busy');
  assert.equal(categoryOf({ activity: '上课', category: 'personal' }), 'personal');
  assert.equal(classifyItem({ activity: '不上班，在家看书' }), 'free');
  assert.equal(classifyItem({ activity: '下班后去看电影' }), 'free');
  assert.equal(classifyItem({ activity: '在家看书', category: 'work' }), 'busy');
  assert.equal(isWorkEvent({ activity: '公司附近吃饭', category: 'meal' }), false);
  assert.equal(isWorkEvent({ activity: '处理一些事情', category: 'work' }), true);
  assert.equal(categoryOf({ activity: '通勤' }), 'commute');
  assert.equal(categoryOf({ activity: '吃午饭' }), 'meal');
});

test('分类正常落盘，缺失或无效值不反写推断；分段修改可清除分类', async () => {
  const items = normalizeItems([{ start: '00:00', end: '24:00', activity: '在家', category: 'personal' }]);
  assert.equal(items[0].category, 'personal');
  assert.equal(normalizeItems([{ ...items[0], category: 'bad' }])[0].category, undefined);
  const changed = applyChange(items, { start: '10:00', end: '11:00', activity: '上课', category: '' });
  assert.equal(changed.find((it) => it.activity === '上课').category, undefined);
  assert.equal(changed[0].category, 'personal');
  const dir = await tmp();
  const written = cleanDay({ items, dayType: 'restday', source: 'coo' }, '2026-11-10');
  await writeDay(dir, written);
  assert.equal((await readDay(dir, written.date)).items[0].category, 'personal');
});

await report();
// 临时目录**故意不删**：`.tmp/` 本来就在 gitignore 里，留着符合项目习惯
// （历次一次性脚本都留在那儿）。更重要的原因：测试末尾的递归删除会被沙箱
// 当成「批量删除」拦下来，`npm test` 就整个跑不完——为了一点磁盘空间不值当。
// 想清的话手动删 test/.tmp 就行。
