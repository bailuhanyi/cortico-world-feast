/**
 * 「她的一天」与 World 的接线测试。
 *
 * 与 `life.test.mjs` 分工不同：那边测日程自己的形状（纯函数 + 临时目录里的存取），
 * 这边测**接缝**——启动时会不会落盘、请她写明天会不会重复叫、交回的 JSON 有没有
 * 真的落盘并更新内存缓存、系统前缀是不是低频的、面板那四个方法通不通。
 *
 * 宿主、定时器、时钟都是假的，跟 world.test.mjs 同一套做法。
 * 不写死工具数 / 事件数 / 面板数（不变式 3），一律从声明算。
 *
 * 临时目录故意不删：见 life.test.mjs 末尾的说明（删目录会被沙箱当批量删除拦下）。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { test, report } from './harness.mjs';
import { FeastWorld, FEAST_TOOL_DECLS } from '../src/world.js';
import { feastDefinition } from '../src/definition.js';
import { DEFAULTS, EVENT_LIFE_FREE, EVENT_LIFE_MOMENT, EVENT_LIFE_PLAN } from '../src/config.js';
import { addDays, dateLabel, listDays, readDay, readPlay, templateDay, writeDay } from '../src/life/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
await mkdir(TMP_ROOT, { recursive: true });

const TZ = 'Asia/Shanghai';
/** 11-05 是周四（工作日），模板一定给「上班日」，日程内容可预期。 */
const DAY = '2026-11-05';
const NOON = Date.parse(`${DAY}T12:05:00+08:00`);
/** 过默认 lifeGenerateAt（22:00），启动就会请她写明天。 */
const NIGHT = Date.parse(`${DAY}T22:30:00+08:00`);

async function makeWorld({ now = () => NOON, cfg = {}, dataDir: reuse = null } = {}) {
  const dataDir = reuse ?? await mkdtemp(join(TMP_ROOT, 'lifew-'));
  const events = [];
  const ticks = [];
  const host = {
    log: { info() {}, warn() {}, debug() {} },
    async pushEvent(e, opts) {
      events.push({ ...e, opts });
      return { ...e, cursor: events.length, origin: e.origin ?? 'external' };
    },
  };
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true, ...cfg },
    dataDir,
    timezone: TZ,
    now,
    random: () => 0.5,
    timers: {
      setInterval: (fn) => { ticks.push(fn); return ticks.length; },
      clearInterval() {},
      setTimeout: (fn) => fn.length, // 启动后那一拍不管，测试自己拨
    },
  });
  await world.start(host);
  const tools = Object.fromEntries(world.tools().map((t) => [t.name, t.handler]));
  /** 触发定时器那一拍，再借一次工具调用把串行队列排空（#tick 是排进队列里跑的）。 */
  const runTick = async () => {
    for (const fn of ticks) await fn();
    await tools.feast_history({});
  };
  const lifeEvents = (type = null) => events.filter((e) => e.type?.startsWith('feast.life')
    && (type === null || e.type === type));
  return { world, host, events, tools, dataDir, runTick, lifeEvents };
}

/** 一份能通过 normalizePlan 的明天。 */
const planPayload = (date) => ({
  date,
  title: '去趟旧书店',
  mood: '有点期待',
  dayType: 'restday',
  items: [
    { start: '00:00', end: '09:00', activity: '睡觉', location: '家' },
    { start: '09:00', end: '12:00', activity: '去旧书店', location: '城里' },
    { start: '12:00', end: '18:00', activity: '在书店待到傍晚', location: '书店' },
    { start: '18:00', end: '24:00', activity: '回家躺着', location: '家' },
  ],
});

// --------------------------------------------------------------------------

test('启动就落盘：今天没有日程时用模板兜底，写成一份完整的一天', async () => {
  const { world, dataDir } = await makeWorld();
  const day = await readDay(dataDir, DAY);
  assert.ok(day, '启动后今天应该已经落盘了');
  assert.equal(day.date, DAY);
  assert.equal(day.source, 'template', `兜底来源该是 template，现在是 ${day.source}`);
  assert.ok(day.items.length >= 2, `一天的段数太少：${day.items.length}`);
  assert.equal(day.items[0].start, '00:00');
  assert.equal(day.items.at(-1).end, '24:00');
  // 首尾相接：中间不能有空档，否则「此刻」会落不进任何一段。
  for (let i = 1; i < day.items.length; i += 1) {
    assert.equal(day.items[i - 1].end, day.items[i].start, '日程中间有空档');
  }
  assert.deepEqual(await listDays(dataDir, 5), [DAY], '只该写了今天这一天');
  await world.stop();
});

test('启动落盘是幂等的：同一份目录重启两次，还是同一天、id 不变', async () => {
  const { world, dataDir } = await makeWorld();
  const first = await readDay(dataDir, DAY);
  await world.stop();
  // 重启：已有文件就该照读，不要用新模板盖掉她写过的内容。
  const { world: w2 } = await makeWorld({ dataDir, cfg: { lifeDayType: 'homebody' } });
  const again = await readDay(dataDir, DAY);
  assert.equal(again.date, first.date);
  assert.equal(again.generatedAt, first.generatedAt, '重启不该重生成今天这一天');
  assert.deepEqual(again.items, first.items, '重启不该改掉已有日程的内容');
  await w2.stop();
});

test('到点请她写明天：只推一次，落一个占位；重启也不会重复叫', async () => {
  const clock = { t: NIGHT };
  const { world, dataDir, runTick, lifeEvents } = await makeWorld({ now: () => clock.t });

  const first = lifeEvents(EVENT_LIFE_PLAN);
  assert.equal(first.length, 1, `傍晚到点该请她写明天，推了 ${first.length} 次`);
  const tomorrow = addDays(DAY, 1);
  assert.equal(first[0].meta.date, tomorrow);
  assert.ok(first[0].text.includes(tomorrow), '事件正文该写清是哪一天');
  assert.ok(first[0].text.includes('feast_life_plan'), '该告诉她用哪个工具交回');
  assert.equal(first[0].origin, 'internal');

  // 占位已经落了：这一天是 pending、没有 items（不然会看起来像她已经想好了）。
  const placeholder = await readDay(dataDir, tomorrow);
  assert.equal(placeholder.source, 'pending');
  assert.equal(placeholder.items.length, 0, '占位不该带 items');

  // 再走十拍，一拍都不该再叫。
  for (let i = 0; i < 10; i += 1) {
    clock.t += 3 * 60_000;
    await runTick();
  }
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, 1, '同一天请了不止一次');

  // 重启（同一个目录）：占位还在，所以也不该再叫。
  await world.stop();
  const { world: w2, lifeEvents: e2 } = await makeWorld({ now: () => clock.t, dataDir });
  await runTick();
  assert.equal(e2(EVENT_LIFE_PLAN).length, 0, '重启后又叫了一次');
  await w2.stop();
});

test('还没到点就不叫：lifeGenerateAt 之前不推事件、不落占位', async () => {
  const clock = { t: Date.parse(`${DAY}T21:00:00+08:00`) };
  const { world, dataDir, runTick, lifeEvents } = await makeWorld({ now: () => clock.t });
  await runTick();
  const tomorrow = addDays(DAY, 1);
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, 0, '21:00 还没到 22:00 就开始了');
  assert.equal(await readDay(dataDir, tomorrow), null, '没到点不该先落占位');

  // 过了点就叫，而且只叫一次。
  clock.t = NIGHT;
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, 1);
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, 1);
  await world.stop();
});

test('她交回 JSON：真的落盘，内存缓存也跟着更新（系统前缀立刻能看到明天）', async () => {
  const clock = { t: NOON };
  const { world, dataDir, tools } = await makeWorld({ now: () => clock.t });
  const tomorrow = addDays(DAY, 1);
  assert.equal(await readDay(dataDir, tomorrow), null, '交回之前不该有明天');

  const r = await tools.feast_life_plan(planPayload(tomorrow));
  assert.ok(!r.failed, `交回被拒了：${r.text}`);
  assert.ok(r.text.includes('记好了'), r.text);

  // 落盘：来源是 coo、标题心情都在、段数对得上。
  const saved = await readDay(dataDir, tomorrow);
  assert.ok(saved, '交回之后盘上没有明天');
  assert.equal(saved.source, 'coo');
  assert.equal(saved.title, '去趟旧书店');
  assert.equal(saved.mood, '有点期待');
  assert.equal(saved.dayType.name, '休息日', `日型该按她给的 restday 走，现在是 ${saved.dayType.name}`);
  assert.equal(saved.items[0].start, '00:00');
  assert.equal(saved.items.at(-1).end, '24:00');

  // 缓存：不看盘、只看系统前缀，也得能读到明天（说明 #lifeTomorrow 更新了）。
  clock.t = Date.parse(`${DAY}T19:00:00+08:00`); // 过了 lifeTomorrowAfter，前缀里才会提明天
  const block = world.envPromptVars().feast_life_block;
  assert.ok(block.includes('去趟旧书店'), '系统前缀里看不到她写的明天——缓存没更新');
  await world.stop();
});

test('她交回的东西不合格时给出清楚的错，而且不动盘上已有的安排', async () => {
  const clock = { t: NOON };
  const { world, dataDir, tools } = await makeWorld({ now: () => clock.t });
  const tomorrow = addDays(DAY, 1);

  const bad = await tools.feast_life_plan({ date: tomorrow, items: [{ start: '09:00', end: '10:00', activity: '' }] });
  assert.equal(bad.failed, true);
  assert.match(bad.text, /activity|两段/, bad.text);
  assert.equal(await readDay(dataDir, tomorrow), null, '不合格的交回不该写盘');

  // 先存一份好的，再用不合格的盖一次：盘上那份要原样留着。
  await tools.feast_life_plan(planPayload(tomorrow));
  const good = await readDay(dataDir, tomorrow);
  const again = await tools.feast_life_plan({ date: tomorrow, items: [] });
  assert.equal(again.failed, true);
  assert.deepEqual(await readDay(dataDir, tomorrow), good, '坏输入把好数据盖掉了');
  await world.stop();
});

test('envPromptVars：同一天里低频（不同时刻完全一致），且永不抛错', async () => {
  const clock = { t: Date.parse(`${DAY}T19:30:00+08:00`) };
  const { world, tools } = await makeWorld({ now: () => clock.t });

  // 先让她交回明天，这样「傍晚之后」那一段内容真的存在，比较才有意义。
  await tools.feast_life_plan(planPayload(addDays(DAY, 1)));

  // 傍晚之后：19:30 和 23:50 都在 lifeTomorrowAfter 之后，内容必须一模一样。
  const evening = world.envPromptVars().feast_life_block;
  clock.t = Date.parse(`${DAY}T23:50:00+08:00`);
  const lateNight = world.envPromptVars().feast_life_block;
  assert.equal(evening, lateNight, '同一天不同时刻的系统前缀不一致——会打穿前缀缓存');
  // 而且**当前**时刻绝不能漏进去：那是 nowText / 事件该管的。
  // （不拿通用正则扫全篇：说话方式那段里有一句固定的「像 13:00–16:00」的举例，
  //   那是给她看的格式示范，不是实时时钟。）
  assert.ok(!evening.includes('19:30'), '前缀里混进了当前时刻');
  assert.ok(!evening.includes('23:50'), '前缀里混进了当前时刻');

  // 傍晚之前不提明天，但今天那部分还在（说明它按 lifeTomorrowAfter 分段，不是整个空掉）。
  clock.t = Date.parse(`${DAY}T09:30:00+08:00`);
  const morning = world.envPromptVars().feast_life_block;
  assert.ok(morning.includes('她的一天'), morning.slice(0, 60));
  assert.ok(!morning.includes('去趟旧书店'), '没到傍晚就把明天说出来了');
  await world.stop();
});

test('envPromptVars：关掉就是一整段空字符串，而不是 null / 抛错', async () => {
  const { world } = await makeWorld({ cfg: { lifeEnabled: false } });
  const vars = world.envPromptVars();
  assert.deepEqual(vars, { feast_life_block: '' },
    '关掉时该给空字符串（返回 null 会把整份 ENV_PROMPT 一起省略）');
  await world.stop();
});

test('envPromptVars：配置里塞垃圾也不抛错（抛错会把整个 World 卸载）', async () => {
  const { world } = await makeWorld();
  // 契约要求这个方法永不抛错：它一抛，World 就被卸载。
  for (const cfg of [
    { lifePrecision: 'nonsense' },
    { lifeTomorrowAfter: '不是时间' },
    { lifeTomorrowAfter: '' },
    { lifeUpcoming: 'x' },
    { lifeVoiceOn: false },
    { lifeDayType: '不存在的日型' },
  ]) {
    world.cfg = { ...DEFAULTS, enabled: true, ...cfg };
    const vars = world.envPromptVars();
    assert.equal(typeof vars?.feast_life_block, 'string', `${JSON.stringify(cfg)} 时没给出字符串`);
  }
  await world.stop();
});

test('时段事件：换一件事才推一句，同一段里不重复推', async () => {
  const clock = { t: Date.parse(`${DAY}T09:30:00+08:00`) };
  const { world, runTick, lifeEvents } = await makeWorld({ now: () => clock.t });

  // 启动首拍只记当前段、不推（不然一启动就冒出一条「这会儿在…」）。
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_MOMENT).length, 0, '启动首拍就推了时段事件');

  // 同一段里再走一拍：还是不推。
  clock.t += 5 * 60_000;
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_MOMENT).length, 0, '同一段里重复推');

  // 挪到几小时后（肯定换了一段）：推一条。
  clock.t = Date.parse(`${DAY}T15:30:00+08:00`);
  await runTick();
  const moments = lifeEvents(EVENT_LIFE_MOMENT);
  assert.equal(moments.length, 1, `换了一段该推一条，推了 ${moments.length} 条`);
  assert.equal(moments[0].opts?.trigger, 'debounce', '时段事件该走 debounce，别打断她');
  assert.ok(moments[0].text.length < 200, '搭车事件太长');

  // 再到深夜里：睡觉时段不推。
  const before = moments.length;
  clock.t = Date.parse(`${DAY}T23:30:00+08:00`);
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_MOMENT).length, before, '睡觉时段推了事件');
  await world.stop();
});

test('时段事件：lifeMomentEvents 关掉就一条都不推', async () => {
  const clock = { t: Date.parse(`${DAY}T09:30:00+08:00`) };
  const { world, runTick, lifeEvents } = await makeWorld({ now: () => clock.t, cfg: { lifeMomentEvents: false } });
  await runTick();
  clock.t = Date.parse(`${DAY}T15:30:00+08:00`);
  await runTick();
  clock.t = Date.parse(`${DAY}T20:00:00+08:00`);
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_MOMENT).length, 0);
  await world.stop();
});

test('饭点事件里带上「你这会儿本来在…」，睡觉时不带', async () => {
  // 12:00 是模板上班日的午饭点；11:30 那一档的饭点提醒正文该提到正在做什么。
  const clock = { t: Date.parse(`${DAY}T11:35:00+08:00`) };
  const { world, runTick, events } = await makeWorld({ now: () => clock.t });
  await runTick();
  const meal = events.find((e) => e.type === 'feast.meal');
  assert.ok(meal, '到饭点没叫');
  assert.ok(meal.text.includes('本来在'), `饭点事件里没带「本来在…」：${meal.text.slice(0, 160)}`);
  await world.stop();

  // 半夜那个点：她本来在睡觉，就不该说这句。
  const clock2 = { t: Date.parse(`${DAY}T23:35:00+08:00`) };
  const { world: w2, runTick: tick2, events: e2 } = await makeWorld({
    now: () => clock2.t,
    cfg: { mealSlots: '23:30' },
  });
  await tick2();
  const meal2 = e2.find((e) => e.type === 'feast.meal');
  if (meal2) assert.ok(!meal2.text.includes('本来在'), '睡着的时候还说「本来在做什么」');
  await w2.stop();
});

test('今天的面板：list 给出今天、明天、此刻、往期，形状对得上', async () => {
  const clock = { t: NOON };
  const { world, dataDir } = await makeWorld({ now: () => clock.t });
  // 造两天的往期，好让 recent 有东西。
  await writeDay(dataDir, templateDay(addDays(DAY, -1), { now: clock.t, dayTypeId: 'restday' }));
  await writeDay(dataDir, templateDay(addDays(DAY, -2), { now: clock.t, dayTypeId: 'outing' }));

  const out = await world.webUi('zh').invoke('today', 'list', []);
  assert.equal(out.enabled, true);
  assert.equal(out.date, DAY);
  assert.equal(out.tomorrowDate, addDays(DAY, 1));
  assert.ok(out.today, '缺今天');
  assert.ok(Array.isArray(out.today.items) && out.today.items.length, '今天的 items 不对');
  assert.equal(out.nowMinute, 12 * 60 + 5);
  assert.equal(out.nowHm, '12:05');
  // 12:05 落在模板上班日的吃午饭那段。
  assert.ok(out.nowItem, '缺「此刻」那一段');
  assert.ok(out.nowItem.activity.includes('午饭'), `此刻落在「${out.nowItem.activity}」`);
  // 面板要自己拼句子，所以不能再给 momentLine 那种给模型看的文本。
  assert.equal(out.now, undefined, 'list 不该再返回给模型看的 now 文本');
  assert.equal(out.nowItem.start, '12:00');

  const dates = out.recent.map((d) => d.date);
  assert.ok(dates.includes(addDays(DAY, -1)), '往期缺昨天');
  assert.ok(dates.includes(addDays(DAY, -2)), '往期缺前天');
  for (const r of out.recent) {
    for (const k of ['date', 'dayType', 'title', 'mood', 'count', 'source']) {
      assert.ok(k in r, `往期条目缺 ${k}`);
    }
  }
  await world.stop();
});

test('今天的面板：声明的每个方法都真的实现了，未知方法给 ok:false 而不是抛错', async () => {
  const { world } = await makeWorld();
  const ui = world.webUi('zh');
  const today = ui.panels.find((p) => p.id === 'today');
  assert.ok(today, 'webUi() 没声明 today 面板');
  assert.ok(today.title && today.description, 'today 面板缺标题或说明');

  // 不写死方法名（不变式 3）：声明了什么就测什么。
  for (const method of today.getMethods) {
    const out = await ui.invoke('today', method, [
      // 按需给参数：day/adjust 要日期，plan 不用，list 不用。
      method === 'day' ? 'today' : method === 'adjust' ? { date: DAY, start: '10:00', end: '11:00', activity: '开小差' } : undefined,
    ]);
    const text = JSON.stringify(out ?? '');
    assert.ok(!text.includes('没有这个方法'), `today.${method} 声明了但没实现：${text.slice(0, 120)}`);
  }

  const unknown = await ui.invoke('today', '不存在的方法', []);
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /没有这个方法/);
  await world.stop();
});

test('今天的面板：day 能取任意一天，非法日期被拒', async () => {
  const { world, dataDir } = await makeWorld();
  const yesterday = addDays(DAY, -1);
  await writeDay(dataDir, templateDay(yesterday, { now: NOON, dayTypeId: 'restday' }));

  const ui = world.webUi('zh');
  const ok = await ui.invoke('today', 'day', [yesterday]);
  assert.equal(ok.ok, true);
  assert.equal(ok.day.date, yesterday);
  assert.equal(ok.day.dayType.name, '休息日');

  const alias = await ui.invoke('today', 'day', ['today']);
  assert.equal(alias.ok, true);
  assert.equal(alias.day.date, DAY, 'today 这个别名没解析成今天');

  const bad = await ui.invoke('today', 'day', ['2026-13-40']);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /日期/);

  // 没有记录的那一天：ok 但 day 为 null（面板据此画「还没想好」）。
  const none = await ui.invoke('today', 'day', ['2020-01-01']);
  assert.equal(none.ok, true);
  assert.equal(none.day, null);
  await world.stop();
});

test('今天的面板：plan 会推事件并落占位，adjust 会改掉盘上那一天', async () => {
  const clock = { t: NOON };
  const { world, dataDir, lifeEvents } = await makeWorld({ now: () => clock.t });
  const ui = world.webUi('zh');
  const tomorrow = addDays(DAY, 1);

  // plan：主人手点「请她写明天」。
  const plan = await ui.invoke('today', 'plan', []);
  assert.equal(plan.ok, true, plan.message);
  // 回执用的是给人看的日期标签（11月6日 星期五），不是 ISO 串——按那个校验。
  assert.ok(plan.message.includes(dateLabel(tomorrow)), `回执该说清是哪一天：${plan.message}`);
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, 1, 'plan 没推事件');
  assert.equal((await readDay(dataDir, tomorrow)).source, 'pending', 'plan 没落占位');

  // adjust：临时改主意。
  const before = await readDay(dataDir, DAY);
  const adj = await ui.invoke('today', 'adjust', [
    { date: DAY, start: '20:00', end: '21:00', activity: '下楼买布丁', location: '便利店' },
  ]);
  assert.equal(adj.ok, true, adj.message);
  const after = await readDay(dataDir, DAY);
  assert.ok(after.items.some((it) => it.activity === '下楼买布丁'), '改完盘上没有这一段');
  assert.equal(after.items[0].start, '00:00');
  assert.equal(after.items.at(-1).end, '24:00');
  assert.equal(after.changes.length, before.changes.length + 1, '改动没记进 changes');
  assert.ok(after.changes.at(-1).note.includes('下楼买布丁'));

  // 改坏了给 ok:false 而不是抛错。
  const bad = await ui.invoke('today', 'adjust', [{ date: DAY, start: '21:00', end: '20:00', activity: 'x' }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.message.includes('时间不对'), bad.message);
  await world.stop();
});

test('关掉 lifeEnabled：面板说清楚它关着，四个方法都不炸', async () => {
  const { world } = await makeWorld({ cfg: { lifeEnabled: false } });
  const ui = world.webUi('zh');
  const list = await ui.invoke('today', 'list', []);
  assert.equal(list.enabled, false);
  assert.equal(list.today, null, '关掉时不该还有今天的日程');

  const plan = await ui.invoke('today', 'plan', []);
  assert.equal(plan.ok, false, '关掉时还能让她写明天');
  assert.ok(plan.message.includes('关着'), plan.message);

  const now = await world.tools().find((t) => t.name === 'feast_life_now').handler({});
  assert.ok(now.text.includes('关着'), now.text);

  const view = await world.tools().find((t) => t.name === 'feast_life_view').handler({});
  assert.ok(view.text.includes('关着'), view.text);
  await world.stop();
});

test('清「她的一天」只清日程，不碰吃过的记录和攒的套餐', async () => {
  const { world, dataDir, tools } = await makeWorld();
  await tools.feast_eat({ dish: '麻婆豆腐' });
  await world.webUi('zh').invoke('combo', 'save', [{ name: '要留住的桌', dishes: ['mapo-tofu'] }]);
  await writeDay(dataDir, templateDay(addDays(DAY, -1), { now: NOON }));

  const st = world.webUi('zh').storage;
  const lifeItem = st.find((s) => s.key === 'feast-life');
  assert.ok(lifeItem, '存储页缺「她的一天」这一项');
  assert.equal(lifeItem.danger, true, '清库项该标成危险');
  assert.ok(lifeItem.location.includes('life'), `清理位置不像日程目录：${lifeItem.location}`);
  assert.ok(lifeItem.stat().includes('天日程'), `统计文案不对：${lifeItem.stat()}`);

  await lifeItem.clear();
  assert.deepEqual(await listDays(dataDir, 5), [], '日程没清干净');
  assert.equal(await readDay(dataDir, DAY), null);

  // 吃过的记录和套餐都还在。
  const h = await tools.feast_history({});
  assert.ok(h.text.includes('吃过 1 回'), '清日程把吃过的记录也清了');
  const combos = await world.webUi('zh').invoke('combo', 'list', [{}]);
  assert.equal(combos.custom.length, 1, '清日程把攒的套餐也清了');

  // 清完之后缓存也要清：面板看不到残留的今天。
  const list = await world.webUi('zh').invoke('today', 'list', []);
  assert.equal(list.today, null, '清完缓存里还留着今天');
  assert.equal(list.nowItem, null);
  await world.stop();
});

test('describe 与 tools() 一致：每个工具都在自描述里，且都配了中英摘要', async () => {
  const { world } = await makeWorld();
  const actual = Object.keys(Object.fromEntries(world.tools().map((t) => [t.name, t]))).sort();
  const described = feastDefinition.describe.tools.map((t) => t.name).sort();
  assert.deepEqual(described, actual, 'describe.json 里的工具和实际注册的对不上');
  assert.deepEqual(described, FEAST_TOOL_DECLS.map((d) => d.name).sort());

  // 新加工具最容易漏摘要：漏了 describe 里就是 undefined，市场页上是一块空白。
  for (const t of feastDefinition.describe.tools) {
    assert.ok(t.summary?.zh, `${t.name} 缺中文摘要`);
    assert.ok(t.summary?.en, `${t.name} 缺英文摘要`);
  }

  // 事件同理：describe 声明的类型必须是 config 里的常量，不能手写字符串。
  const eventTypes = feastDefinition.describe.events.map((e) => e.type);
  for (const t of [EVENT_LIFE_PLAN, EVENT_LIFE_MOMENT]) {
    assert.ok(eventTypes.includes(t), `describe 缺事件 ${t}`);
  }
  for (const e of feastDefinition.describe.events) {
    assert.ok(e.description?.zh && e.description?.en, `${e.type} 缺中英说明`);
    assert.ok(['flush', 'debounce'].includes(e.trigger), `${e.type} 的 trigger 不对：${e.trigger}`);
  }
  await world.stop();
});

test('四个 life 工具都在声明里，且都带 feast_ 前缀（bot 内工具名全局唯一）', async () => {
  const names = FEAST_TOOL_DECLS.map((d) => d.name);
  for (const must of ['feast_life_now', 'feast_life_view', 'feast_life_plan', 'feast_life_adjust']) {
    assert.ok(names.includes(must), `缺工具 ${must}`);
  }
  // 融合后的工具一律走 feast_ 前缀，别残留 dsh 那边的 schedule_*。
  for (const n of names) assert.ok(n.startsWith('feast_'), `工具名没走 feast_ 前缀：${n}`);

  // 工具名不能重名（宿主里重名会互相覆盖）。
  assert.equal(new Set(names).size, names.length, '有重名的工具');
});

test('feast_life_now / _view：回执说的是她自己的日子，且随时刻变', async () => {
  const clock = { t: Date.parse(`${DAY}T09:30:00+08:00`) };
  const { world, tools } = await makeWorld({ now: () => clock.t });

  const morning = await tools.feast_life_now({});
  assert.ok(morning.text.includes('09:30'), morning.text.slice(0, 80));
  assert.ok(!morning.text.includes('{{'), '回执里漏了没替换的模板变量');

  clock.t = Date.parse(`${DAY}T23:30:00+08:00`);
  const night = await tools.feast_life_now({});
  assert.notEqual(morning.text, night.text, '一天不同时刻说的一模一样');

  // view：全天时间线，首尾都排到。
  const view = await tools.feast_life_view({ date: 'today' });
  assert.ok(!view.failed, view.text);
  assert.ok(view.text.includes('00:00'), '时间线没从 00:00 开始');
  assert.ok(view.text.includes('24:00'), '时间线没排到 24:00');

  await world.stop();
});

test('feast_life_adjust：改的是她指定的那一天，没日程时如实说改不了', async () => {
  const { world, tools, dataDir } = await makeWorld();
  const target = addDays(DAY, 3);
  assert.equal(await readDay(dataDir, target), null);

  const none = await tools.feast_life_adjust({ date: target, start: '10:00', end: '11:00', activity: '发呆' });
  assert.equal(none.failed, true, '没有日程的一天居然改成功了');
  assert.match(none.text, /还没有日程/);

  await writeDay(dataDir, templateDay(target, { now: NOON, dayTypeId: 'restday' }));
  const ok = await tools.feast_life_adjust({ date: target, start: '10:00', end: '11:00', activity: '发呆' });
  assert.ok(!ok.failed, ok.text);
  const saved = await readDay(dataDir, target);
  assert.ok(saved.items.some((it) => it.activity === '发呆'));
  // 回执里说的是「跟人说起时直接说决定本身，别提『调整日程』」——那是在交代说话方式，
  // 不能因为它出现了「调整日程」四个字就判成文案不合格。
  assert.ok(ok.text.includes('发呆'), ok.text);
  assert.ok(/改/.test(ok.text), '回执该说清改成了什么');
  await world.stop();
});

test('feast_life_adjust：activity 留空 = 不做了，落盘里那段真没了', async () => {
  const clock = { t: Date.parse(`${DAY}T12:05:00+08:00`) };
  const { world, tools, dataDir } = await makeWorld({ now: () => clock.t });
  const before = await readDay(dataDir, DAY);
  // 模板上班日 13:00–18:00 是「上班」，挖掉 16:00–18:00。
  const i = before.items.findIndex((it) => it.start === '13:00');
  assert.ok(i >= 0, '模板里没有 13:00 那一段，这条测试的前提变了');

  const r = await tools.feast_life_adjust({ start: '16:00', end: '18:00' });
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes('不去了'), `回执该说清是取消：${r.text}`);

  const after = await readDay(dataDir, DAY);
  assert.equal(after.items[0].start, '00:00');
  assert.equal(after.items.at(-1).end, '24:00');
  for (let k = 1; k < after.items.length; k += 1) {
    assert.equal(after.items[k - 1].end, after.items[k].start, '取消后落盘出现空档');
  }
  // 记进 changes 的是「不去了」，不是编出来的一件新事。
  assert.ok(after.changes.at(-1).note.includes('不去了'), after.changes.at(-1).note);
  // 取消当前那一段会改变「此刻」，缓存也得跟着走。
  const now = await world.webUi('zh').invoke('today', 'list', []);
  assert.ok(now.nowItem, '取消后「此刻」丢了');
  await world.stop();
});

test('feast_life_adjust：今天的过去改不了（那是事实，不是计划）', async () => {
  const clock = { t: Date.parse(`${DAY}T15:00:00+08:00`) };
  const { world, tools, dataDir } = await makeWorld({ now: () => clock.t });
  const before = await readDay(dataDir, DAY);

  // 早上 8 点已经过完：她自己不许改。
  const past = await tools.feast_life_adjust({ start: '08:00', end: '09:00', activity: '其实我在家睡懒觉' });
  assert.equal(past.failed, true, '过去的时段被她改了');
  assert.match(past.text, /过去了/, past.text);
  assert.ok(past.text.includes('feast_life_now'), '该告诉她真忘了就用 feast_life_now');
  assert.deepEqual(await readDay(dataDir, DAY), before, '被拒的改动居然写盘了');

  // 晚点还没到：能改。
  const future = await tools.feast_life_adjust({ start: '19:00', end: '20:00', activity: '去看电影' });
  assert.ok(!future.failed, future.text);

  // 明天整天都能改（那是计划）。
  const tomorrow = addDays(DAY, 1);
  await writeDay(dataDir, templateDay(tomorrow, { now: clock.t, dayTypeId: 'restday' }));
  const tm = await tools.feast_life_adjust({ date: tomorrow, start: '08:00', end: '09:00', activity: '赖床' });
  assert.ok(!tm.failed, `明天早上改不了？${tm.text}`);
  await world.stop();
});

test('feast_life_adjust：lifeAdjustPast 打开后她也能改过去', async () => {
  const clock = { t: Date.parse(`${DAY}T15:00:00+08:00`) };
  const { world, tools } = await makeWorld({ now: () => clock.t, cfg: { lifeAdjustPast: true } });
  const r = await tools.feast_life_adjust({ start: '08:00', end: '09:00', activity: '其实我在家睡懒觉' });
  assert.ok(!r.failed, `开关打开了还是不给改：${r.text}`);
  await world.stop();
});

test('feast_life_adjust：主人从面板可以改过去，而且改动署名是 owner', async () => {
  const clock = { t: Date.parse(`${DAY}T15:00:00+08:00`) };
  const { world, dataDir } = await makeWorld({ now: () => clock.t });
  const ui = world.webUi('zh');
  // 她自己被拒的那一段，主人来改就该通。
  const r = await ui.invoke('today', 'adjust', [
    { date: DAY, start: '08:00', end: '09:00', activity: '睡到九点才起', location: '家' },
  ]);
  assert.equal(r.ok, true, `主人改过去被拒了：${r.message}`);
  const saved = await readDay(dataDir, DAY);
  assert.ok(saved.items.some((it) => it.activity === '睡到九点才起'));
  assert.equal(saved.changes.at(-1).by, 'owner', '主人的改动署名该是 owner，不是 coo');
  await world.stop();
});

test('改完日程立刻补一条时段事件：她那一拍的依据马上更新', async () => {
  const clock = { t: Date.parse(`${DAY}T15:00:00+08:00`) };
  const { world, tools, lifeEvents, runTick } = await makeWorld({ now: () => clock.t });

  // 先走一拍，把基线段落下来（首拍只记不推）。
  await runTick();
  const base = lifeEvents(EVENT_LIFE_MOMENT).length;

  // 改「此刻」那一段：15:00 本来在上班，改成出去买咖啡。
  const r = await tools.feast_life_adjust({ start: '14:00', end: '16:00', activity: '出去买咖啡', location: '咖啡店' });
  assert.ok(!r.failed, r.text);

  const after = lifeEvents(EVENT_LIFE_MOMENT);
  assert.equal(after.length, base + 1, '改完没有立刻补事件，她要等到下次跨段才知道');
  const fresh = after.at(-1);
  assert.equal(fresh.meta?.reason, 'adjust', '补的这条该标出是被改出来的');
  assert.ok(fresh.text.includes('买咖啡'), `事件正文没跟上新安排：${fresh.text}`);

  // 紧接着再走一拍：不该重复推（基线已经重置）。
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_MOMENT).length, base + 1, '补完之后又推了一遍');

  // 系统前缀也立刻跟上。
  const block = world.envPromptVars().feast_life_block;
  assert.ok(block.includes('买咖啡'), '系统前缀没跟上改动');
  await world.stop();
});

test('改「不是此刻」的段不补事件（没换事，不该冒一条）', async () => {
  const clock = { t: Date.parse(`${DAY}T15:00:00+08:00`) };
  const { world, tools, lifeEvents, runTick } = await makeWorld({ now: () => clock.t });
  await runTick();
  const base = lifeEvents(EVENT_LIFE_MOMENT).length;
  const r = await tools.feast_life_adjust({ start: '20:00', end: '21:00', activity: '看会儿书' });
  assert.ok(!r.failed, r.text);
  assert.equal(lifeEvents(EVENT_LIFE_MOMENT).length, base, '改晚上的事却冒了一条「此刻」');
  await world.stop();
});

// --------------------------------------------------------------------------
// 自由时间（从 playtime World 并进来）
// --------------------------------------------------------------------------

test('自由时间：日程说在睡觉/上班时不叫，自由时段才叫', async () => {
  const cases = [
    ['睡觉时段', '03:00', 0],
    ['上班时段', '10:00', 0],
    ['晚上自由时段', '21:00', 1],
  ];
  for (const [label, slot, want] of cases) {
    const clock = { t: Date.parse(`${DAY}T${slot}:00+08:00`) + 120_000 };
    const { world, runTick, lifeEvents } = await makeWorld({
      now: () => clock.t, cfg: { lifeFreeSlots: slot },
    });
    await runTick();
    const n = lifeEvents(EVENT_LIFE_FREE).length;
    assert.equal(n, want, `${label}（${slot}）叫了 ${n} 次，该是 ${want}`);
    await world.stop();
  }
});

test('自由时间：叫醒事件带上日程里那一段、菜单和记账指引', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeMenu: '- 出去走走\n- 看个视频' },
  });
  await runTick();
  const ev = lifeEvents(EVENT_LIFE_FREE)[0];
  assert.ok(ev, '晚上自由时段没叫醒她');
  assert.equal(ev.origin, 'internal');
  assert.ok(ev.text.includes('你自己的时间'), ev.text.slice(0, 80));
  assert.ok(ev.text.includes('出去走走'), '菜单没贴进去');
  assert.ok(ev.text.includes('feast_life_play'), '没说怎么记账');
  // 日程里 19:45–23:00 是「自己的时间」：不能拼出「你在自己的时间里」。
  assert.ok(!/本来在自己的时间/.test(ev.text), `措辞别扭：${ev.text.split('\n')[1]}`);
  assert.equal(ev.meta?.slot, '21:00');
  await world.stop();
});

test('自由时间：记账落盘、进度累加、做满就不再叫', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, dataDir, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeGoal: 2, lifeFreeAskReport: true },
  });
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 1);

  const r1 = await tools.feast_life_play({ activity: '出去走走', note: '看见一只三花猫' });
  assert.ok(!r1.failed, r1.text);
  assert.ok(r1.text.includes('出去走走'));
  // 措辞不能像「额度还没完成」：说清那只是个上限，随时能继续。
  assert.ok(r1.text.includes('不按点叫'), `没说清那是叫醒的上限：${r1.text}`);
  assert.ok(!/还差 \d+ 件/.test(r1.text), `写成「还差 N 件」像在派任务：${r1.text}`);
  assert.ok(r1.text.includes('随时'), `没说明随时能做：${r1.text}`);
  assert.ok(r1.text.includes('跟主人说一句'), 'askReport 开着却没提醒');

  const saved = await readPlay(dataDir, DAY);
  assert.equal(saved.done.length, 1);
  assert.equal(saved.done[0].note, '看见一只三花猫');
  assert.equal(saved.pending, null, '记完该收掉 pending');

  // 到数了：回执要说「过了这个数就不再按点叫」，而不是「够了好收手」。
  const r2 = await tools.feast_life_play({ activity: '看了会儿视频' });
  assert.ok(/不再按点叫/.test(r2.text), `到数了没说不按点叫：${r2.text}`);
  assert.ok(!/够了，接下来不叫你了，自己玩/.test(r2.text), '旧措辞：像在打发她收手');

  // 到数之后照样能记、照样算数——goal 是叫醒上限，不是额度。
  const r3 = await tools.feast_life_play({ activity: '临时起意下楼买了根冰棍' });
  assert.ok(!r3.failed, `到数之后不让记了：${r3.text}`);
  const saved3 = await readPlay(dataDir, DAY);
  assert.equal(saved3.done.length, 3, '到数之后的记录没算数');

  // 做满之后不该再**按点叫**，但这只是不再叫，不是不许动。
  const before = lifeEvents(EVENT_LIFE_FREE).length;
  clock.t += 3 * 3600_000;
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, before, '做满了还在按点叫');
  await world.stop();
});

test('自由时间：不用等叫醒，随时能自己开始（跳过今天之后也行）', async () => {
  // 09:00 一档都还没到，且先跳过今天：这个入口照样得能用。
  const clock = { t: Date.parse(`${DAY}T09:00:00+08:00`) };
  const { world, tools } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeGoal: 2, lifeFreeMenu: '- 出去走走' },
  });
  await tools.feast_life_skip({ reason: '今天不想被叫' });

  const r = await tools.feast_life_start({ mood: '想出去透透气' });
  assert.ok(!r.failed, `跳过之后就不能自己开始了：${r.text}`);
  assert.ok(r.text.includes('不用等下一档'), `没说清不用等：${r.text}`);
  assert.ok(r.text.includes('出去走走'), '没给例子');
  assert.ok(r.text.includes('feast_life_play'), '没说怎么记');
  assert.ok(r.text.includes('想出去透透气'), '没接住她的话');
  assert.ok(r.text.includes('不照着也行') || r.text.includes('只是个例子'), '没说明清单只是举例');

  // 自己开始之后照样能记账，而且算数。
  const log = await tools.feast_life_play({ activity: '下楼转了一圈' });
  assert.ok(!log.failed, log.text);
  const play = await readPlay(world.dataDir, DAY);
  assert.equal(play.done.length, 1, '自己开始之后记的账没算');
  await world.stop();
});

test('自由时间：做满之后还能自己开始，且明说那不是上限', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeGoal: 1 },
  });
  await tools.feast_life_play({ activity: '出去走了走' });
  const r = await tools.feast_life_start({});
  assert.ok(!r.failed, r.text);
  assert.ok(/不是上限|想动随时动/.test(r.text), `做满后没说明那不是上限：${r.text}`);
  await world.stop();
});

test('自由时间：单子外的事也算，回执不把清单当任务', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeGoal: 3 },
  });
  await runTick();
  const ev = lifeEvents(EVENT_LIFE_FREE)[0];
  assert.ok(ev, '没叫醒');
  // 清单只是举例，得说明白：不照着做也行。
  assert.ok(/只是.{0,6}例子|不照着也行/.test(ev.text), `没说明清单只是举例：${ev.text}`);
  // 什么都记：单子外的、临时起意的、甚至「发呆」。
  for (const act of ['在窗边发呆', '临时起意去便利店', '什么也没做']) {
    const r = await tools.feast_life_play({ activity: act });
    assert.ok(!r.failed, `${act} 记不进去：${r.text}`);
  }
  await world.stop();
});

test('自由时间：activity 为空被拒，且不写盘', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, dataDir } = await makeWorld({ now: () => clock.t });
  const bad = await tools.feast_life_play({ activity: '   ' });
  assert.equal(bad.failed, true);
  assert.match(bad.text, /activity/);
  assert.equal(await readPlay(dataDir, DAY), null, '坏输入居然写盘了');
  await world.stop();
});

test('自由时间：跳过之后今天不再叫', async () => {
  const clock = { t: Date.parse(`${DAY}T09:58:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '10:00' },
  });
  await tools.feast_life_skip({ reason: '今天不想动' });
  clock.t = Date.parse(`${DAY}T10:02:00+08:00`);
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 0, '跳过之后还在叫');
  await world.stop();
});

test('自由时间：日程改过之后，叫醒事件跟着新安排走（不是各说各的）', async () => {
  // 15:00 本来在上班（不该叫）。先把她改成自由段，再让那一档到点——
  // 顺序很重要：一档判过一次（不管是叫了还是没叫）就不再重判，这是防每一拍重算的设计。
  const clock = { t: Date.parse(`${DAY}T14:50:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '15:00' },
  });
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 0, '还没到档就叫了');

  // 把 14:00–16:00 改成自由段。
  const r = await tools.feast_life_adjust({ start: '14:00', end: '16:00', activity: '自己的时间', location: '家' });
  assert.ok(!r.failed, r.text);

  // 到档了：这会儿日程说是她自己的时间，该叫。
  clock.t = Date.parse(`${DAY}T15:02:00+08:00`);
  await runTick();
  const ev = lifeEvents(EVENT_LIFE_FREE);
  assert.equal(ev.length, 1, '改成自由段之后还是没叫');
  assert.ok(ev[0].text.includes('你现在在家'), `没带上新安排：${ev[0].text.split('\n')[1]}`);
  await world.stop();
});

test('自由时间：play 单独存一份，不被 feast_life_plan 重写覆盖', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, dataDir } = await makeWorld({ now: () => clock.t });
  await tools.feast_life_play({ activity: '出去走走' });
  // 她重新交回今天的日程：play 记录不该受影响。
  await tools.feast_life_plan({
    date: 'today',
    items: [
      { start: '00:00', end: '12:00', activity: '睡觉' },
      { start: '12:00', end: '24:00', activity: '自己的时间' },
    ],
  });
  const play = await readPlay(dataDir, DAY);
  assert.equal(play.done.length, 1, '重写日程把 play 记录冲掉了');
  assert.equal(play.done[0].activity, '出去走走');
  await world.stop();
});

test('自由时间：关掉之后不叫，工具如实说关着', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeEnabled: false, lifeFreeSlots: '21:00' },
  });
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 0);
  const r = await tools.feast_life_play({ activity: '出去走走' });
  assert.equal(r.failed, true);
  await world.stop();
});

test('自由时间：清「她的一天」把记录一起清掉，但不碰吃过的和套餐', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, dataDir } = await makeWorld({ now: () => clock.t });
  await tools.feast_eat({ dish: '麻婆豆腐' });
  await world.webUi('zh').invoke('combo', 'save', [{ name: '留着', dishes: ['mapo-tofu'] }]);
  await tools.feast_life_play({ activity: '出去走走' });
  assert.ok(await readPlay(dataDir, DAY), '记账没落盘');

  const lifeItem = world.webUi('zh').storage.find((s) => s.key === 'feast-life');
  await lifeItem.clear();
  assert.equal(await readPlay(dataDir, DAY), null, '自由时间记录没被清掉');
  assert.ok((await tools.feast_history({})).text.includes('吃过 1 回'), '把吃过的也清了');
  const combos = await world.webUi('zh').invoke('combo', 'list', [{}]);
  assert.equal(combos.custom.length, 1, '把攒的套餐也清了');
  await world.stop();
});

await report();
