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
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { test, report } from './harness.mjs';
import { FeastWorld, FEAST_TOOL_DECLS } from '../src/world.js';
import { feastDefinition } from '../src/definition.js';
import { DEFAULTS, EVENT_LIFE_FREE, EVENT_LIFE_MOMENT, EVENT_LIFE_PLAN, EVENT_MEAL } from '../src/config.js';
import { addDays, dateLabel, listDays, parseSlots, playPath, readDay, readPlay, templateDay, writeDay } from '../src/life/index.js';
import { clearWardrobeCache } from '../src/life/wardrobe.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
await mkdir(TMP_ROOT, { recursive: true });

const TZ = 'Asia/Shanghai';
/** 11-05 是周四（工作日），模板一定给「上班日」，日程内容可预期。 */
const DAY = '2026-11-05';
const NOON = Date.parse(`${DAY}T12:05:00+08:00`);
/** 过默认 lifeGenerateAt（22:00），启动就会请她写明天。 */
const NIGHT = Date.parse(`${DAY}T22:30:00+08:00`);

async function makeWorld({ now = () => NOON, cfg = {}, dataDir: reuse = null, botDir, create = (opts) => new FeastWorld(opts) } = {}) {
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
  const world = create({
    cfg: { ...DEFAULTS, enabled: true, ...cfg },
    dataDir,
    botDir,
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

test('写日程和重写按当前配置独立联动小世界与娱乐时间', async () => {
  const hostDir = await mkdtemp(join(TMP_ROOT, 'plan-links-'));
  const dataDir = join(hostDir, 'data');
  const configPath = join(hostDir, 'config.json');
  const enableBoth = JSON.stringify({ worlds: { map: { enabled: true }, fun: { enabled: true } } });
  await mkdir(dataDir);
  await writeFile(configPath, enableBoth);
  const { world, lifeEvents, tools } = await makeWorld({
    dataDir, now: () => NIGHT, cfg: { lifeFreeEnabled: false },
  });
  try {
    const first = lifeEvents(EVENT_LIFE_PLAN)[0];
    assert.match(first.text, /map_places.*map_look.*location/);
    assert.match(first.text, /fun_places.*营业时间.*activity \/ detail/);
    assert.match(first.text, /map_look 提到娱乐时间里相近的场所，先用 fun_places 核对/);
    assert.match(first.text, /真要出发时再用 fun_go/);

    const plan = await tools.feast_life_plan(planPayload('tomorrow'));
    assert.ok(!plan.failed, plan.text);
    await writeFile(configPath, JSON.stringify({ worlds: { map: { enabled: true }, fun: { enabled: false } } }));
    const rewrite = await world.webUi('zh').invoke('today', 'plan', []);
    assert.ok(rewrite.ok, rewrite.message);
    const last = lifeEvents(EVENT_LIFE_PLAN).at(-1);
    assert.equal(last.meta.rewrite, true);
    assert.match(last.text, /map_places/);
    assert.doesNotMatch(last.text, /fun_places|fun_go/);
  } finally {
    await world.stop();
  }

  await writeFile(configPath, enableBoth);
  const optOut = await makeWorld({ dataDir, cfg: { lifeFreeMapOn: false } });
  try {
    const rewrite = await optOut.world.webUi('zh').invoke('today', 'plan', []);
    assert.ok(rewrite.ok, rewrite.message);
    const last = optOut.lifeEvents(EVENT_LIFE_PLAN).at(-1);
    assert.match(last.text, /fun_places/);
    assert.doesNotMatch(last.text, /map_places|map_look/);
  } finally {
    await optOut.world.stop();
  }
});

test('D1 工厂把部署目录传给计划与自由时间联动', async () => {
  const root = await mkdtemp(join(TMP_ROOT, 'd1-deployment-'));
  const botDir = join(root, 'deployment');
  const dataDir = join(root, 'legacy', 'data');
  await mkdir(botDir);
  await mkdir(dataDir, { recursive: true });
  const stale = JSON.stringify({ worlds: { fun: { enabled: true }, map: { enabled: true } } });
  await writeFile(join(dataDir, 'config.json'), stale);
  await writeFile(join(root, 'legacy', 'config.json'), stale);
  await writeFile(join(botDir, 'config.json'), JSON.stringify({ worlds: { fun: { enabled: false }, map: { enabled: true } } }));

  const realNow = Date.now;
  let setup;
  try {
    // 生产工厂不透传测试定时器，固定 Date.now 并由 finally 停止 World。
    Date.now = () => NOON;
    setup = await makeWorld({ botDir, dataDir, create: feastDefinition.create });
    const { world, tools, lifeEvents } = setup;
    const ui = world.webUi('zh');
    assert.equal((await ui.invoke('today', 'plan', [])).ok, true);
    const invite = lifeEvents(EVENT_LIFE_PLAN).at(-1);
    assert.match(invite.text, /\bmap_places\b/);
    assert.doesNotMatch(invite.text, /\bfun_(?:places|go|story)\b/);
    const reply = await tools.feast_life_start({});
    assert.ok(!reply.failed, reply.text);
    assert.match(reply.text, /\bmap_places\b/);
    assert.doesNotMatch(reply.text, /\bfun_(?:places|go|story)\b/);
  } finally {
    try { if (setup) await setup.world.stop(); }
    finally { Date.now = realNow; }
  }
});

test('D1 自由时间定时、工具和面板共用同一配置优先级', async () => {
  const root = await mkdtemp(join(TMP_ROOT, 'd1-compatible-'));
  const dataDir = join(root, 'data');
  await mkdir(dataDir);
  const current = join(dataDir, 'config.json');
  await writeFile(join(root, 'config.json'), JSON.stringify({ worlds: { map: { enabled: true } } }));
  await writeFile(current, JSON.stringify({ worlds: { fun: { enabled: true } } }));
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({ dataDir, now: () => clock.t });
  try {
    await runTick();
    const reminder = lifeEvents(EVENT_LIFE_FREE).at(-1);
    assert.equal(reminder.meta.slot, '21:00');
    assert.match(reminder.text, /\bfun_places\b/);
    assert.doesNotMatch(reminder.text, /\bmap_places\b/);

    const ui = world.webUi('zh');
    await writeFile(current, '{截断');
    const reply = await tools.feast_life_start({});
    assert.ok(!reply.failed, reply.text);
    assert.doesNotMatch(reply.text, /\b(?:fun|map)_places\b/);

    await unlink(current);
    const before = lifeEvents(EVENT_LIFE_FREE).length;
    assert.equal((await ui.invoke('today', 'freeStart', [])).ok, true);
    assert.equal(lifeEvents(EVENT_LIFE_FREE).length, before + 1);
    const panelEvent = lifeEvents(EVENT_LIFE_FREE).at(-1);
    assert.match(panelEvent.text, /\bmap_places\b/);
    assert.doesNotMatch(panelEvent.text, /\bfun_places\b/);
  } finally { await world.stop(); }
});

test('D1 故事候选只服务计划，显式记录保留实际游玩与中途暂停', async () => {
  const dataDir = await mkdtemp(join(TMP_ROOT, 'd1-story-'));
  const foreignState = ['fun', 'map'].map((id) => join(dataDir, id, 'state.json'));
  for (const file of foreignState) {
    await mkdir(dirname(file));
    await writeFile(file, '{"fixture":"只供本测试核对"}');
  }
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ worlds: { fun: { enabled: true } } }));
  const clock = { t: NOON };
  const candidate = '和主人商量玩一篇已安装的短故事';
  const example = '闲下来时翻翻剪贴册';
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    dataDir,
    now: () => clock.t,
    cfg: { lifeDayType: 'workday', lifeDoings: `- 通用候选：整理抽屉\n上班日：\n- ${candidate}`, lifeFreeMenu: `- ${example}` },
  });
  try {
    const ui = world.webUi('zh');
    const tomorrow = addDays(DAY, 1);
    assert.equal((await ui.invoke('today', 'plan', [])).ok, true);
    const invite = lifeEvents(EVENT_LIFE_PLAN).at(-1);
    assert.ok(invite.text.includes(candidate));
    assert.doesNotMatch(invite.text, /整理抽屉|闲下来时翻翻剪贴册|\bfun_story\b/);
    const draft = await readDay(dataDir, tomorrow);
    assert.equal(draft.source, 'pending');
    assert.deepEqual(draft.items, []);
    const plan = planPayload(tomorrow);
    plan.items[1] = { ...plan.items[1], activity: candidate };
    const saved = await tools.feast_life_plan(plan);
    assert.ok(!saved.failed, saved.text);
    const day = await readDay(dataDir, tomorrow);
    assert.ok(day.items.some((item) => item.activity === candidate));
    assert.ok(day.items.every((item) => !item.activity.includes(example)));

    clock.t = Date.parse(`${DAY}T21:02:00+08:00`);
    await runTick();
    const reminder = lifeEvents(EVENT_LIFE_FREE).at(-1);
    assert.ok(reminder.text.includes(example));
    assert.doesNotMatch(reminder.text, /\bfun_story\b/);
    clock.t = Date.parse(`${DAY}T23:05:00+08:00`);
    await runTick();
    assert.deepEqual((await readPlay(dataDir, DAY))?.done ?? [], []);
    assert.deepEqual((await readPlay(dataDir, tomorrow))?.done ?? [], []);
    assert.deepEqual((await ui.invoke('today', 'list', [])).actual, []);

    const activity = '和主人玩了一个短故事';
    const note = '玩到木桥后先暂停，故事还没结束';
    const logged = await tools.feast_life_play({ activity, note });
    assert.ok(!logged.failed, logged.text);
    const { done } = await readPlay(dataDir, DAY);
    assert.deepEqual(done.map(({ activity, note }) => ({ activity, note })), [{ activity, note }]);
    assert.deepEqual(await readDay(dataDir, tomorrow), day);
    for (const file of foreignState) assert.equal(await readFile(file, 'utf8'), '{"fixture":"只供本测试核对"}');
  } finally { await world.stop(); }
});

test('她写好明天之后再点「请她写明天」：不覆盖、只推一次重写邀请', async () => {
  const clock = { t: NOON };
  const { world, dataDir, lifeEvents, tools } = await makeWorld({ now: () => clock.t });
  const tomorrow = addDays(DAY, 1);

  // 先让她真写好明天。
  const out = await tools.feast_life_plan({
    date: 'tomorrow',
    title: '写好的明天',
    items: [
      { start: '00:00', end: '08:00', activity: '睡觉' },
      { start: '08:00', end: '24:00', activity: '她认真写的' },
    ],
  });
  assert.ok(!out.failed, out.text);
  const before = await readDay(dataDir, tomorrow);
  assert.equal(before.source, 'coo');
  // 0.7.1 的那个 bug：这里会把她的明天清成 pending/0 段。
  const r = await world.webUi('zh').invoke('today', 'plan', []);
  assert.ok(r.ok, r.message);
  assert.match(r.message, /重新想想/, `回执该说是「重新想想」：${r.message}`);

  const after = await readDay(dataDir, tomorrow);
  assert.equal(after.source, 'coo', '她写的那一版不该被降级成占位');
  assert.equal(after.items.length, 2, '段数也不该变');
  assert.ok(after.items.some((it) => it.activity === '她认真写的'), '内容一个字都不该动');

  // 推给她的事件要说得跟夜里第一次不一样，且带上 rewrite。
  const evs = lifeEvents(EVENT_LIFE_PLAN);
  const last = evs[evs.length - 1];
  assert.equal(last.meta.rewrite, true);
  assert.match(last.text, /重新想想/, '正文该说这是重写，别让她以为自己没写过');

  // 连着再点两下：冷却窗口内不该连推（她还没回，催第二遍没意义）。
  const n = evs.length;
  await world.webUi('zh').invoke('today', 'plan', []);
  await world.webUi('zh').invoke('today', 'plan', []);
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, n, '冷却窗口内不该重复推');
  const still = await readDay(dataDir, tomorrow);
  assert.equal(still.items.length, 2, '连点也不该动她的明天');
  await world.stop();
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
  // 0.7.3 加了天气块：默认关（没填城市）时它也是空串，和 feast_life_block 同构。
  // 日程和天气关掉仍要提供变量；独立的饭菜来源说明继续保留。
  assert.equal(typeof vars.feast_meal_origin_block, 'string');
  assert.ok(vars.feast_meal_origin_block.includes('自己选菜只表示自己选来吃'));
  assert.deepEqual(vars, { feast_life_block: '', feast_weather_block: '', feast_meal_origin_block: vars.feast_meal_origin_block },
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
  const { world, runTick, lifeEvents } = await makeWorld({ now: () => clock.t, cfg: { lifeMomentEvents: true } });

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
  const { world, tools, lifeEvents, runTick } = await makeWorld({ now: () => clock.t, cfg: { lifeMomentEvents: true } });

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

test('自由时间：积压档位只发最近一档，重启后不补发旧档，后续档照常叫', async () => {
  const clock = { t: Date.parse(DAY + 'T21:12:00+08:00') };
  const cfg = { lifeFreeSlots: '21:00,21:05,21:10,22:00' };
  const first = await makeWorld({ now: () => clock.t, cfg });
  await first.runTick();
  await first.runTick();
  assert.equal(first.lifeEvents(EVENT_LIFE_FREE).length, 1);
  assert.equal(first.lifeEvents(EVENT_LIFE_FREE)[0].meta.slot, '21:10');
  const saved = await readPlay(first.dataDir, DAY);
  assert.deepEqual(Object.keys(saved.fired).sort(), ['21:00', '21:05', '21:10']);
  await first.world.stop();
  const restarted = await makeWorld({ now: () => clock.t, cfg, dataDir: first.dataDir });
  await restarted.runTick();
  assert.equal(restarted.lifeEvents(EVENT_LIFE_FREE).length, 0);
  clock.t = Date.parse(DAY + 'T22:02:00+08:00');
  await restarted.runTick();
  assert.equal(restarted.lifeEvents(EVENT_LIFE_FREE).length, 1);
  assert.equal(restarted.lifeEvents(EVENT_LIFE_FREE)[0].meta.slot, '22:00');
  await restarted.world.stop();
});

test('自由时间：发送失败不消耗积压档位，下一拍成功后只叫一次', async () => {
  const setup = await makeWorld({
    now: () => Date.parse(DAY + 'T21:12:00+08:00'),
    cfg: { lifeFreeSlots: '21:00,21:05,21:10' },
  });
  const push = setup.host.pushEvent;
  let attempts = 0;
  setup.host.pushEvent = async (event, options) => {
    if (event.type === EVENT_LIFE_FREE && ++attempts === 1) throw new Error('模拟发送失败');
    return push(event, options);
  };
  await setup.runTick();
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 0);
  assert.equal(await readPlay(setup.dataDir, DAY), null);
  await setup.runTick();
  await setup.runTick();
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 1);
  assert.equal(attempts, 2);
  const saved = await readPlay(setup.dataDir, DAY);
  assert.deepEqual(Object.keys(saved.fired).sort(), ['21:00', '21:05', '21:10']);
  await setup.world.stop();
});

test('自由时间：送达后写盘失败只重试保存，关闭提醒也会补存，重启不重叫', async () => {
  const now = () => Date.parse(DAY + 'T21:02:00+08:00');
  const cfg = { lifeFreeSlots: '21:00' };
  const setup = await makeWorld({ now, cfg });
  const blockedPath = playPath(setup.dataDir, DAY);
  const warnings = [];
  setup.host.log.warn = (message) => warnings.push(message);
  await mkdir(blockedPath);
  await setup.runTick();
  await setup.runTick();
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 1);
  await assert.rejects(readPlay(setup.dataDir, DAY), /记录读取失败/);
  assert.ok(warnings.some((message) => message.includes('重试保存')));
  await rmdir(blockedPath);
  setup.world.cfg.lifeFreeEnabled = false;
  await setup.runTick();
  const saved = await readPlay(setup.dataDir, DAY);
  assert.ok(saved && '21:00' in saved.fired, '没有新提醒时也应重试保存已送达记录');
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 1);
  await setup.world.stop();
  const restarted = await makeWorld({ now, cfg, dataDir: setup.dataDir });
  await restarted.runTick();
  assert.equal(restarted.lifeEvents(EVENT_LIFE_FREE).length, 0);
  await restarted.world.stop();
});

test('自由时间：停止前补存已送达记录，重启后不重叫', async () => {
  const now = () => Date.parse(DAY + 'T21:02:00+08:00');
  const cfg = { lifeFreeSlots: '21:00' };
  const setup = await makeWorld({ now, cfg });
  const blockedPath = playPath(setup.dataDir, DAY);
  await mkdir(blockedPath);
  await setup.runTick();
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 1);
  await assert.rejects(readPlay(setup.dataDir, DAY), /记录读取失败/);
  await rmdir(blockedPath);
  await setup.world.stop();
  const saved = await readPlay(setup.dataDir, DAY);
  assert.ok(saved && '21:00' in saved.fired);
  const restarted = await makeWorld({ now, cfg, dataDir: setup.dataDir });
  await restarted.runTick();
  assert.equal(restarted.lifeEvents(EVENT_LIFE_FREE).length, 0);
  await restarted.world.stop();
});

test('自由时间：清空日程后不恢复此前保存失败的旧记录', async () => {
  const setup = await makeWorld({
    now: () => Date.parse(DAY + 'T21:02:00+08:00'), cfg: { lifeFreeSlots: '21:00' },
  });
  await setup.tools.feast_life_play({ activity: '旧记录' });
  const before = await readPlay(setup.dataDir, DAY);
  const blockedPath = `${playPath(setup.dataDir, DAY)}.bak`;
  await mkdir(blockedPath);
  await setup.runTick();
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 1);
  assert.deepEqual(await readPlay(setup.dataDir, DAY), before, '备份失败应保留旧记录，已送达状态尚未写盘');
  await rmdir(blockedPath);
  await setup.world.webUi('zh').storage.find((item) => item.key === 'feast-life').clear();
  setup.world.cfg.lifeFreeSlots = '';
  await setup.runTick();
  assert.equal(await readPlay(setup.dataDir, DAY), null);
  assert.equal(setup.lifeEvents(EVENT_LIFE_FREE).length, 1);
  await setup.world.stop();
  assert.equal(await readPlay(setup.dataDir, DAY), null, '停止时也不应恢复清空前待保存的记录');
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

test('自由时间：记账落盘、回执不把清单当任务，记了几件不挡下一档', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, dataDir, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00,22:00', lifeFreeAskReport: true },
  });
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 1);

  const r1 = await tools.feast_life_play({ activity: '出去走走', note: '看见一只三花猫' });
  assert.ok(!r1.failed, r1.text);
  assert.ok(r1.text.includes('出去走走'));
  assert.ok(r1.text.includes('今天记了 1 件'), `没报件数：${r1.text}`);
  // 措辞不能像「额度还没完成」，也不能拿「做够就不叫」当奖励。
  assert.ok(!/还差 \d+ 件/.test(r1.text), `写成「还差 N 件」像在派任务：${r1.text}`);
  assert.ok(!/不再按点叫|到 \d+ 件/.test(r1.text), `还在提「做够就不叫」：${r1.text}`);
  assert.ok(r1.text.includes('随时'), `没说明随时能做：${r1.text}`);
  assert.ok(r1.text.includes('跟主人说一句'), 'askReport 开着却没提醒');

  const saved = await readPlay(dataDir, DAY);
  assert.equal(saved.done.length, 1);
  assert.equal(saved.done[0].note, '看见一只三花猫');
  assert.equal(saved.pending, undefined, '0.8.0 起没有 pending');

  // 记了三件，到下一档照样叫：档位是上限，不是「记够了就闭嘴」。
  await tools.feast_life_play({ activity: '看了会儿视频' });
  await tools.feast_life_play({ activity: '临时起意下楼买了根冰棍' });
  clock.t = Date.parse(`${DAY}T22:02:00+08:00`);
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 2, '记了几件不该挡掉下一档');
  await world.stop();
});

test('自由时间：她主动开始时照实说——上班说上班，不说「现在就是你自己的时间」', async () => {
  const clock = { t: Date.parse(`${DAY}T10:00:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeMenu: '- 出去走走\n- 看个视频' },
  });
  // 工具那条路（10:00 是模板里的上班时段）
  const r = await tools.feast_life_start({ mood: '想透口气' });
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes('上班'), `没照实说这会儿在上班：${r.text}`);
  assert.ok(!r.text.includes('现在就是你自己的时间'), `上班时说「现在就是你自己的时间」：${r.text}`);
  assert.ok(r.text.includes('出去走走'), '她主动问的该给例子（给全才对）');

  // 面板那条路也一样，而且面板会真推一条事件出去
  const pr = await world.webUi('zh').invoke('today', 'freeStart', []);
  assert.ok(pr.ok, JSON.stringify(pr));
  const ev = lifeEvents(EVENT_LIFE_FREE).at(-1);
  assert.ok(ev, '面板该推一条');
  assert.ok(ev.text.includes('上班'), `面板那条没照实说：${ev.text.slice(0, 80)}`);
  assert.ok(!ev.text.includes('现在是你自己的时间'), '面板那条还在撒谎');

  // 空档时段还是原来那句话
  clock.t = Date.parse(`${DAY}T21:02:00+08:00`);
  await runTick();
  const ok = await tools.feast_life_start({});
  assert.ok(ok.text.includes('现在就是你自己的时间'), ok.text);
  await world.stop();
});

test('自由时间：忙着时默认不叫（面板留痕），开了 lifeFreeBusyCall 才叫且换成报备措辞', async () => {
  const clock = { t: Date.parse(`${DAY}T09:55:00+08:00`) };
  const off = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '10:00,21:00', lifeFreeMenu: '- 出去转转' },
  });
  const getReminders = async ({ world }) => (await world.webUi().invoke('today', 'list', [])).reminders;
  assert.deepEqual((await getReminders(off)).free, { status: 'busy', slot: '10:00', lastSkipped: null });
  clock.t = Date.parse(`${DAY}T10:02:00+08:00`);
  await off.runTick();
  assert.equal(off.lifeEvents(EVENT_LIFE_FREE).length, 0, '默认为什么在上班时段叫她');
  const play = await readPlay(off.dataDir, DAY);
  assert.equal(play.skippedSlots['10:00'].doing.includes('上班'), true, '跳过了却没留痕，面板没法解释');
  const reminder = (await getReminders(off)).free;
  assert.equal(reminder.slot, '21:00');
  assert.deepEqual(reminder.lastSkipped, { slot: '10:00', doing: play.skippedSlots['10:00'].doing });
  await off.world.stop();

  clock.t = Date.parse(`${DAY}T10:00:00+08:00`);
  const on = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '10:00', lifeFreeMenu: '- 出去转转', lifeFreeBusyCall: true },
  });
  assert.equal((await getReminders(on)).free.status, 'checkIn');
  await on.runTick();
  const ev = on.lifeEvents(EVENT_LIFE_FREE)[0];
  assert.ok(ev, '开了「忙着的时候也叫」却没叫');
  assert.ok(ev.text.includes('这会儿你在上班'), ev.text.slice(0, 60));
  assert.ok(!ev.text.includes('你自己的时间'), '忙时报备不能说「这是你的时间」');
  assert.ok(!ev.text.includes('出去转转'), '忙时不该贴出门的例子');
  await on.world.stop();
});

test('自由时间：睡觉永远不叫，开了 lifeFreeBusyCall 也一样', async () => {
  const clock = { t: Date.parse(`${DAY}T03:00:00+08:00`) };
  const { world, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '03:00', lifeFreeBusyCall: true },
  });
  const home = await world.webUi().invoke('today', 'list', []);
  assert.deepEqual(home.reminders.free, { status: 'asleep', slot: '03:00', lastSkipped: null });
  await runTick();
  assert.equal(lifeEvents(EVENT_LIFE_FREE).length, 0, '凌晨三点把人叫起来报备');
  await world.stop();
});

test('自由时间：不用等叫醒，随时能自己开始（跳过今天之后也行）', async () => {
  // 09:00 一档都还没到，且先跳过今天：这个入口照样得能用。
  const clock = { t: Date.parse(`${DAY}T09:00:00+08:00`) };
  const { world, tools } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00', lifeFreeMenu: '- 出去走走' },
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

test('自由时间：记过几件之后照样能自己开始，回执不拿「做够」当门槛', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00' },
  });
  await tools.feast_life_play({ activity: '出去走了走' });
  const r = await tools.feast_life_start({});
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes('现在就是你自己的时间'), r.text);
  assert.ok(!/不是上限|到 \d+ 件/.test(r.text), `还在解释「那不是上限」，等于承认有上限：${r.text}`);
  await world.stop();
});

test('自由时间：单子外的事也算，回执不把清单当任务', async () => {
  const clock = { t: Date.parse(`${DAY}T21:02:00+08:00`) };
  const { world, tools, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeFreeSlots: '21:00' },
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
  // 15:00 本来在上班（默认不该叫）。先改成自由段，再让那一档到点：
  // 判据在「到档那一拍」才取，所以改完就按新安排判。
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

// --------------------------------------------------------------------------
// 生图工作室联动（0.7.1）：World 接缝
// --------------------------------------------------------------------------

/** 在 dataDir 下建一个迷你 imggen-library：1 人物（带情境穿搭 + 默认服饰）、2 衣服、1 场景。 */
async function makeImggenLib(dataDir) {
  const root = join(dataDir, 'imggen-library');
  const mk = async (kind, name, obj) => {
    const d = join(root, kind, name);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'entry.json'), JSON.stringify(obj), 'utf8');
  };
  await mk('characters', '青', {
    name: '青', aliases: ['深深'], tags: ['蓝发'],
    defaultOutfit: '女仆裙', outfitByContext: { 睡前: '睡衣', 通勤: '通勤衬衫' },
  });
  await mk('outfits', '睡衣', { name: '睡衣', aliases: ['居家服'], tags: ['睡衣'] });
  await mk('outfits', '通勤衬衫', { name: '通勤衬衫', aliases: ['衬衫'], tags: ['通勤'] });
  await mk('outfits', '女仆裙', { name: '女仆裙', aliases: ['女仆装'], tags: ['洛丽塔'] });
  await mk('scenes', '卧室', { name: '卧室', aliases: [], tags: [] });
}

test('联动：库非空时 envPromptVars 带指向生图工作室的一句', async () => {
  clearWardrobeCache();
  const { world, runTick } = await makeWorld();
  await makeImggenLib(world.dataDir);
  await runTick(); // 拨一拍让 #lifeEnsure 刷新 wardrobe 快照（envPromptVars 同步读它）
  const vars = world.envPromptVars();
  assert.ok(vars.feast_life_block.includes('生图工作室'), '前缀里要有指向句');
  assert.ok(vars.feast_life_block.includes('青'), '指向句带人物名');
  await world.stop();
});

test('联动：请她写明天的事件正文里列出素材库', async () => {
  clearWardrobeCache();
  const clock = { t: NIGHT };
  // 先建 dataDir + 库，再 makeWorld：start() 里就会 #lifeEnsure 推 plan，
  // 必须那时库已就绪，否则 plan 正文（start 时推的那条）不带库。
  const dataDir = await mkdtemp(join(TMP_ROOT, 'lifew-lib-'));
  await makeImggenLib(dataDir);
  const { world, lifeEvents } = await makeWorld({ now: () => clock.t, dataDir });
  const plan = lifeEvents(EVENT_LIFE_PLAN).at(-1);
  assert.ok(plan, '该推了一条 plan 事件');
  assert.ok(plan.text.includes('睡衣'), 'plan 正文列出衣柜');
  assert.ok(plan.text.includes('卧室'), 'plan 正文列出场景');
  assert.ok(plan.text.includes('睡前→睡衣'), 'plan 正文列出情境穿搭');
  await world.stop();
});

test('联动：交回日程后自动补 outfit 并落盘（不覆盖她自己填的）', async () => {
  clearWardrobeCache();
  const { world, tools, dataDir, runTick } = await makeWorld();
  await makeImggenLib(dataDir);
  await runTick();
  const tomorrow = addDays(DAY, 1);
  await tools.feast_life_plan({
    date: tomorrow,
    dayType: 'restday',
    title: '在家一天',
    items: [
      { start: '00:00', end: '08:00', activity: '睡觉', situation: '睡前' },
      { start: '08:00', end: '12:00', activity: '起床', situation: '刚睡醒' },
      { start: '12:00', end: '18:00', activity: '在家玩', outfit: '运动服' },
      { start: '18:00', end: '24:00', activity: '准备睡觉', situation: '睡前' },
    ],
  });
  const day = await readDay(dataDir, tomorrow);
  assert.ok(day, '交回的日程该落盘');
  assert.equal(day.items[0].outfit, '睡衣', '睡前段补睡衣（context）');
  assert.equal(day.items[1].outfit, '睡衣', '刚睡醒段补睡衣（context）');
  assert.equal(day.items[2].outfit, '运动服', '模型填的不覆盖');
  assert.equal(day.items[3].outfit, '睡衣', '睡前段补睡衣（context）');
  await world.stop();
});

test('联动：关掉 lifeWardrobeOn 时不补、不注入、plan 不带库', async () => {
  clearWardrobeCache();
  const clock = { t: NIGHT };
  const { world, tools, dataDir, runTick, lifeEvents } = await makeWorld({
    now: () => clock.t, cfg: { lifeWardrobeOn: false },
  });
  await makeImggenLib(dataDir);
  await runTick();
  const vars = world.envPromptVars();
  assert.ok(!vars.feast_life_block.includes('生图工作室'), '关掉后前缀不带指向句');
  const plan = lifeEvents(EVENT_LIFE_PLAN).at(-1);
  assert.ok(plan);
  assert.ok(!plan.text.includes('睡衣'), '关掉后 plan 不列库');
  // 交回的日程不补
  const tomorrow = addDays(DAY, 1);
  await tools.feast_life_plan({
    date: tomorrow, dayType: 'restday', items: [
      { start: '00:00', end: '08:00', activity: '睡觉', situation: '睡前' },
      { start: '08:00', end: '24:00', activity: '在家', situation: '休闲' },
    ],
  });
  const day = await readDay(dataDir, tomorrow);
  assert.ok(!day.items[0].outfit, '关掉后不补 outfit');
  await world.stop();
});

test('联动：库读不到时静默降级，日程照常、前缀不炸', async () => {
  clearWardrobeCache();
  const { world, tools, dataDir, runTick } = await makeWorld(); // 不建 imggen-library
  await runTick();
  const vars = world.envPromptVars();
  assert.ok(!vars.feast_life_block.includes('生图工作室'), '没库不带指向句');
  assert.ok(vars.feast_life_block.length > 0, '前缀照常有（她的一天还在）');
  // 交回日程不补，但正常落盘
  const tomorrow = addDays(DAY, 1);
  await tools.feast_life_plan({
    date: tomorrow, dayType: 'restday', items: [
      { start: '00:00', end: '12:00', activity: '睡觉', situation: '睡前' },
      { start: '12:00', end: '24:00', activity: '在家' },
    ],
  });
  const day = await readDay(dataDir, tomorrow);
  assert.ok(day, '没库也照常落盘');
  assert.ok(!day.items[0].outfit, '没库不补');
  await world.stop();
});

test('联动：imggen 改了 libraryRoot，feast 自动跟上（不靠默认路径）', async () => {
  clearWardrobeCache();
  // 造一个独立 parent：config.json 在 parent/，dataDir 在 parent/data，
  // 库建在 parent/自定义库/ 下（不是默认的 parent/data/imggen-library）。
  const parent = join(TMP_ROOT, `libroot-${Date.now()}`);
  const dataDir = join(parent, 'data');
  await mkdir(dataDir, { recursive: true });
  const customLib = join(parent, '自定义生图库');
  await writeFile(join(parent, 'config.json'), JSON.stringify({
    worlds: { imggen: { libraryRoot: customLib } },
  }), 'utf8');
  // 在自定义库路径下建迷你库
  const mk = async (kind, name, obj) => {
    const d = join(customLib, kind, name);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'entry.json'), JSON.stringify(obj), 'utf8');
  };
  await mk('characters', '青', {
    name: '青', aliases: ['深深'], tags: ['蓝发'],
    defaultOutfit: '女仆裙', outfitByContext: { 睡前: '睡衣' },
  });
  await mk('outfits', '睡衣', { name: '睡衣', aliases: ['居家服'], tags: ['睡衣'] });
  await mk('outfits', '女仆裙', { name: '女仆裙', aliases: ['女仆装'], tags: ['洛丽塔'] });

  const { world, runTick } = await makeWorld({ dataDir });
  await runTick();
  const vars = world.envPromptVars();
  assert.ok(vars.feast_life_block.includes('生图工作室'), '库在自定义路径下也读到了 → 前缀带指向句');
  assert.ok(vars.feast_life_block.includes('青'), '指向句带人物名');
  await world.stop();
});

test('损坏日程不会在启动或下一拍被模板覆盖', async () => {
  const dataDir = await mkdtemp(join(TMP_ROOT, 'broken-day-'));
  await mkdir(join(dataDir, 'feast', 'life'), { recursive: true });
  const file = join(dataDir, 'feast', 'life', `${DAY}.json`);
  const broken = '{broken-day';
  await writeFile(file, broken, 'utf8');
  const { world, runTick } = await makeWorld({ dataDir });
  await runTick();
  await world.stop();
  assert.equal(await readFile(file, 'utf8'), broken);
});

test('损坏活动记录不会在提醒或记活动时被空记录覆盖', async () => {
  const dataDir = await mkdtemp(join(TMP_ROOT, 'broken-play-'));
  await mkdir(join(dataDir, 'feast', 'life'), { recursive: true });
  const file = playPath(dataDir, DAY);
  const broken = '{broken-play';
  await writeFile(file, broken, 'utf8');
  const { world, runTick, tools } = await makeWorld({ dataDir });
  await runTick();
  const out = await tools.feast_life_play({ activity: '读书' });
  assert.equal(out.failed, true);
  assert.match(out.text, /记录损坏/);
  await world.stop();
  assert.equal(await readFile(file, 'utf8'), broken);
});

test('上限为8时内置模板仍保留全天，超限重交不覆盖原日程', async () => {
  const { world, tools, dataDir } = await makeWorld({ cfg: { lifeMaxItems: 8, lifeDayType: 'workday' } });
  const today = await readDay(dataDir, DAY);
  assert.equal(today.items.at(-1).end, '24:00');
  const tomorrow = addDays(DAY, 1);
  await tools.feast_life_plan(planPayload(tomorrow));
  const file = join(dataDir, 'feast', 'life', `${tomorrow}.json`);
  const before = await readFile(file, 'utf8');
  const items = Array.from({ length: 12 }, (_, i) => ({
    start: `${String(i * 2).padStart(2, '0')}:00`,
    end: `${String(i * 2 + 2).padStart(2, '0')}:00`, activity: `活动${i}`,
  }));
  const out = await tools.feast_life_plan({ date: tomorrow, items });
  assert.equal(out.failed, true);
  assert.match(out.text, /合并.*重新提交/);
  assert.equal(await readFile(file, 'utf8'), before);
  await world.stop();
});

test('生活首页只把实际活动和饮食列为记录，计划留在安排中', async () => {
  const { world, tools } = await makeWorld();
  const ui = world.webUi();
  assert.equal(ui.panels[0].id, 'today');
  assert.ok(!ui.panels[0].getMethods.includes('recovery'));
  let home = await ui.invoke('today', 'list', []);
  assert.deepEqual(home.actual, []);
  await tools.feast_life_play({ activity: '读了两章书', note: '想明天接着看' });
  await tools.feast_eat({ dish: '麻婆豆腐' });
  home = await ui.invoke('today', 'list', []);
  assert.equal(home.actual.length, 2);
  assert.ok(home.actual.some((item) => item.kind === 'activity' && item.text === '读了两章书'));
  assert.deepEqual(home.threads.items, [], '活动不会自动变成跨天小事');
  await world.stop();
});

test('小事明确留下后跨天进入邀请，完成或放下后不再提示', async () => {
  const clock = { t: NOON };
  const { world, tools, dataDir, lifeEvents } = await makeWorld({ now: () => clock.t });
  const out = await tools.feast_life_thread({ action: 'add', text: '接着看那本书' });
  assert.ok(!out.failed);
  const ui = world.webUi();
  let home = await ui.invoke('today', 'list', []);
  const thread = home.threads.items[0];
  assert.equal(thread.source, 'coo');
  await ui.invoke('today', 'plan', []);
  assert.match(lifeEvents(EVENT_LIFE_PLAN).at(-1).text, /接着看那本书/);
  await world.stop();
  clock.t += 24 * 60 * 60_000;
  const restarted = await makeWorld({ dataDir, now: () => clock.t });
  home = await restarted.world.webUi().invoke('today', 'list', []);
  assert.equal(home.threads.items[0].id, thread.id);
  const listed = await restarted.tools.feast_life_thread({ action: 'list' });
  assert.equal(JSON.parse(listed.text).items.length, 1, 'list 默认只带进行中的小事');
  const done = await restarted.tools.feast_life_thread({ action: 'done', id: thread.id });
  assert.ok(!done.failed);
  await restarted.world.webUi().invoke('today', 'plan', []);
  assert.ok(!restarted.lifeEvents(EVENT_LIFE_PLAN).at(-1).text.includes('接着看那本书'));
  await restarted.world.stop();
});

test('恢复日程会保留损坏原档，拒绝传入任意文件路径', async () => {
  const { world, tools, dataDir } = await makeWorld();
  await tools.feast_life_plan(planPayload(addDays(DAY, 1)));
  await tools.feast_life_plan({ ...planPayload(addDays(DAY, 1)), title: '新想法' });
  const file = join(dataDir, 'feast', 'life', `${addDays(DAY, 1)}.json`);
  await writeFile(file, '{broken', 'utf8');
  const ui = world.webUi();
  const home = await ui.invoke('today', 'list', []);
  assert.ok(home.storageIssues.find((item) => item.key === 'tomorrow')?.backupAvailable);
  const bad = await ui.invoke('today', 'recovery', [{ key: file, action: 'restore' }]);
  assert.equal(bad.ok, false);
  const restored = await ui.invoke('today', 'recovery', [{ key: 'tomorrow', action: 'restore' }]);
  assert.equal(restored.ok, true);
  assert.equal((await readDay(dataDir, addDays(DAY, 1))).title, '去趟旧书店');
  await world.stop();
});

test('等待写明天超过十分钟后手动重发一次，重复操作有冷却', async () => {
  const clock = { t: NOON };
  const { world, lifeEvents } = await makeWorld({ now: () => clock.t });
  const ui = world.webUi();
  await ui.invoke('today', 'plan', []);
  assert.equal((await ui.invoke('today', 'list', [])).planRetryAvailable, false);
  clock.t += 11 * 60_000;
  assert.equal((await ui.invoke('today', 'list', [])).planRetryAvailable, true);
  await ui.invoke('today', 'plan', [{ retry: true }]);
  await ui.invoke('today', 'plan', [{ retry: true }]);
  assert.equal(lifeEvents(EVENT_LIFE_PLAN).length, 2);
  await world.stop();
});

// --------------------------------------------------------------------------
// 0.10.0：上不上班的开关 + 饭点档位由她自己定
// --------------------------------------------------------------------------

test('feast_life_day：说不上班后换日型并移除工作事件，其他安排保留', async () => {
  const { world, tools, dataDir } = await makeWorld();
  const before = await readDay(dataDir, DAY);
  assert.equal(before.work, true, '周四的模板该是上班日');
  assert.equal(before.dayType.id, 'workday');

  const out = await tools.feast_life_day({ work: false });
  assert.ok(!out.failed, out.text);
  const after = await readDay(dataDir, DAY);
  assert.equal(after.work, false);
  assert.equal(after.dayType.id === 'workday' || after.dayType.id === 'overtime' || after.dayType.id === 'slacking',
    false, `日型还留在上班那一类：${after.dayType.name}`);
  assert.deepEqual(after.items.map((it) => it.start), before.items.map((it) => it.start),
    '替换工作事件时保留原时段边界');
  assert.ok(!after.items.some((it) => /上班|通勤|下班|加班|摸鱼/.test(it.activity)),
    '不上班后不能残留工作安排');
  assert.ok(after.items.filter((it) => it.activity === '自由安排').every((it) => it.location === '家'),
    '被替换的工作时段应改为居家自由安排');
  assert.ok(after.items.some((it) => it.activity === '吃午饭'), '非工作安排应保留');
  assert.ok(after.changes.at(-1).note.includes('不上班'));

  // 再翻回来只改变标记和日型，不凭空复原已移除的工作事件。
  await tools.feast_life_day({ work: true });
  const back = await readDay(dataDir, DAY);
  assert.equal(back.work, true);
  assert.ok(!back.items.some((it) => /通勤|上班|下班回家/.test(it.activity)),
    '翻回上班不应自动编造工作安排');
  await world.stop();
});

test('feast_life_day：她自己定饭点，到点就按她定的叫，不是配置里那两个点', async () => {
  const clock = { t: Date.parse(`${DAY}T12:00:00+08:00`) };
  const { world, tools, dataDir, runTick, events } = await makeWorld({ now: () => clock.t });
  const out = await tools.feast_life_day({ mealSlots: ['13:10', '20:00'] });
  assert.ok(!out.failed, out.text);
  assert.deepEqual((await readDay(dataDir, DAY)).mealSlots, ['13:10', '20:00']);

  // 13:15 到点该叫她（配置里的 11:30 已经过去了，但她没定它）。
  const meals = () => events.filter((e) => e.type === 'feast.meal');
  assert.equal(meals().length, 0);
  clock.t = Date.parse(`${DAY}T13:15:00+08:00`);
  await runTick();
  assert.equal(meals().length, 1, `该叫一顿，叫了 ${meals().length} 顿`);
  assert.equal(meals()[0].meta.slot, '13:10');
  await world.stop();
});

test('她自己定饭点：关掉「饭点由她自己定」就不采用，仍按配置叫', async () => {
  const clock = { t: Date.parse(`${DAY}T12:00:00+08:00`) };
  const { world, tools, dataDir, runTick, events } = await makeWorld({
    now: () => clock.t, cfg: { mealSlotsByHer: false, mealSlots: '11:30,18:00' },
  });
  await tools.feast_life_day({ mealSlots: ['13:10'] });
  assert.deepEqual((await readDay(dataDir, DAY)).mealSlots, ['13:10'], '她写的还是记下来，只是不采用');
  clock.t = Date.parse(`${DAY}T13:15:00+08:00`);
  await runTick();
  const meals = events.filter((e) => e.type === 'feast.meal');
  // 关掉之后 13:10 不再是档位；今天一档都没叫过，所以按配置补最近过去的那一顿（11:30）。
  assert.ok(!meals.some((e) => e.meta.slot === '13:10'), '关掉之后 13:10 这一档不该叫');
  assert.equal(meals.at(-1)?.meta.slot, '11:30', '仍按配置那组补一顿');
  const list = await world.webUi().invoke('today', 'list', []);
  assert.deepEqual(list.mealSlots, ['11:30', '18:00'], '面板上该是配置那组');
  assert.equal(list.mealSlotsByHer, false);
  await world.stop();
});

test('她没定饭点时，面板报的是配置那组（mealSlotsByHer=false）', async () => {
  const { world } = await makeWorld();
  const list = await world.webUi().invoke('today', 'list', []);
  assert.equal(list.mealSlotsByHer, false);
  assert.deepEqual(list.mealSlots, parseSlots(DEFAULTS.mealSlots).map((s) => s.hm));
  assert.equal(list.work, true, '周四模板是上班日');
  await world.stop();
});test('feast_life_plan：写日程时顺手定饭点、说不上班，一次交回', async () => {
  const { world, tools, dataDir } = await makeWorld();
  const target = addDays(DAY, 1);
  const out = await tools.feast_life_plan({ ...planPayload(target), mealSlots: ['12:30', '19:30'], work: false });
  assert.ok(!out.failed, out.text);
  const day = await readDay(dataDir, target);
  assert.deepEqual(day.mealSlots, ['12:30', '19:30']);
  assert.equal(day.work, false);
  assert.ok(!day.items.some((it) => /上班|通勤|下班|加班|摸鱼|公司|办公室|工位/.test(it.activity)),
    'plan 同时指定不上班时不能留下工作事件');
  assert.match(out.text, /饭点 12:30、19:30/);
  await world.stop();
});

test('feast_life_plan：饭点写歪了整份拒掉，原日程不动（不静默退回默认档位）', async () => {
  const { world, tools, dataDir } = await makeWorld();
  const target = addDays(DAY, 1);
  await tools.feast_life_plan(planPayload(target));
  const before = await readDay(dataDir, target);
  const bad = await tools.feast_life_plan({ ...planPayload(target), title: '不该写进去', mealSlots: ['乱写'] });
  assert.equal(bad.failed, true);
  assert.match(bad.text, /HH:MM/);
  const after = await readDay(dataDir, target);
  assert.equal(after.title, before.title, '写歪了不该把原来那一天盖掉');
  await world.stop();
});

test('feast_life_day：日程还没有时不凭空造一天，如实说等日程', async () => {
  const { world, tools, dataDir } = await makeWorld();
  const target = addDays(DAY, 3);
  const out = await tools.feast_life_day({ date: target, work: false });
  assert.equal(out.failed, true);
  assert.match(out.text, /还没有日程/);
  assert.equal(await readDay(dataDir, target), null, '别为了定个标记就写一份空日程出去');
  await world.stop();
});

test('feast_life_day：两件事都没说时如实说没得改，不落盘', async () => {
  const { world, tools, dataDir } = await makeWorld();
  const before = await readFile(join(dataDir, 'feast', 'life', `${DAY}.json`), 'utf8');
  const out = await tools.feast_life_day({});
  assert.equal(out.failed, true);
  assert.match(out.text, /没说要改什么/);
  assert.equal(await readFile(join(dataDir, 'feast', 'life', `${DAY}.json`), 'utf8'), before);
  await world.stop();
});

test('面板 work：主人一句话翻掉今天上不上班；没有日程时给 ok:false 而不是抛错', async () => {
  const { world, dataDir } = await makeWorld();
  const ui = world.webUi('zh');
  const off = await ui.invoke('today', 'work', [{ date: DAY, work: false }]);
  assert.equal(off.ok, true, off.message);
  assert.equal((await readDay(dataDir, DAY)).work, false);
  const on = await ui.invoke('today', 'work', [{ date: DAY, work: true }]);
  assert.equal(on.ok, true);
  assert.equal((await readDay(dataDir, DAY)).work, true);

  const none = await ui.invoke('today', 'work', [{ date: addDays(DAY, 4), work: false }]);
  assert.equal(none.ok, false);
  assert.match(none.message, /还没有日程/);

  const bad = await ui.invoke('today', 'work', [{ date: DAY }]);
  assert.equal(bad.ok, false, '不写 work 时要明确拒绝');
  await world.stop();
});

test('面板：work 在 today 的方法声明里，list 也给出这两个字段', async () => {
  const { world } = await makeWorld();
  const ui = world.webUi('zh');
  const today = ui.panels.find((p) => p.id === 'today');
  assert.ok(today.getMethods.includes('work'), 'work 没声明，面板点不到');
  const list = await ui.invoke('today', 'list', []);
  for (const key of ['work', 'mealSlots', 'mealSlotsByHer']) {
    assert.ok(key in list, `list 缺 ${key}`);
  }
  await world.stop();
});

test('请她写明天：开着「饭点由她自己定」时正文换成邀请她定，而不是告诉她照旧', async () => {
  const { world, tools, lifeEvents } = await makeWorld();
  assert.ok('feast_life_day' in tools, '缺 feast_life_day');
  await world.webUi().invoke('today', 'plan', []);
  const text = lifeEvents(EVENT_LIFE_PLAN).at(-1).text;
  assert.match(text, /mealSlots/, '没告诉她可以带上饭点');
  assert.match(text, /由你定/);
  await world.stop();
});

test('请她写明天：关掉「饭点由她自己定」时正文仍是「照旧是 11:30、18:00」', async () => {
  const { world, lifeEvents } = await makeWorld({ cfg: { mealSlotsByHer: false } });
  await world.webUi().invoke('today', 'plan', []);
  const text = lifeEvents(EVENT_LIFE_PLAN).at(-1).text;
  assert.match(text, /饭点照旧是/, '关掉后不该再邀请她自己定');
  assert.match(text, /11:30/);
  await world.stop();
});

test('上班预览不写盘，过期预览拒绝；撤销跨重启且保留新饭点', async () => {
  const setup = await makeWorld();
  const ui = setup.world.webUi('zh');
  const before = await readDay(setup.dataDir, DAY);
  const preview = await ui.invoke('today', 'work', [{ work: false, action: 'preview' }]);
  assert.ok(preview.affected.some((it) => it.activity === '通勤'));
  assert.deepEqual(await readDay(setup.dataDir, DAY), before);
  const off = await ui.invoke('today', 'work', [{ work: false, revision: preview.revision }]);
  assert.equal(off.ok, true);
  const stale = await ui.invoke('today', 'work', [{ work: false, revision: preview.revision }]);
  assert.equal(stale.ok, false);
  await setup.tools.feast_life_day({ mealSlots: ['12:45'] });
  await setup.world.stop();
  const restarted = await makeWorld({ dataDir: setup.dataDir });
  try {
    const result = await restarted.world.webUi('zh').invoke('today', 'work', [{ action: 'undo' }]);
    assert.equal(result.ok, true, result.message);
    const restored = await readDay(setup.dataDir, DAY);
    assert.deepEqual(restored.items, before.items);
    assert.equal(restored.work, before.work);
    assert.deepEqual(restored.mealSlots, ['12:45']);
    assert.equal(restored.workUndo, undefined);
  } finally { await restarted.world.stop(); }
});

test('不上班的旧日程只报告冲突；主动清理后若时段已改则拒绝撤销', async () => {
  const setup = await makeWorld();
  try {
    const original = await readDay(setup.dataDir, DAY);
    await writeDay(setup.dataDir, { ...original, work: false, dayType: { id: 'restday', name: '休息日' } });
    const file = join(setup.dataDir, 'feast', 'life', `${DAY}.json`);
    const bytes = await readFile(file, 'utf8');
    const ui = setup.world.webUi('zh');
    const home = await ui.invoke('today', 'list', []);
    assert.ok(home.workConflicts.length > 0);
    assert.equal(await readFile(file, 'utf8'), bytes, '查询不应静默修复磁盘');
    await ui.invoke('today', 'work', [{ work: false }]);
    await ui.invoke('today', 'adjust', [{ date: DAY, start: '20:00', end: '21:00', activity: '新计划' }]);
    const changed = await readFile(file, 'utf8');
    const undo = await ui.invoke('today', 'work', [{ action: 'undo' }]);
    assert.equal(undo.ok, false);
    assert.equal(await readFile(file, 'utf8'), changed);
  } finally { await setup.world.stop(); }
});

test('分类工具参数、展示推断与持久化一致；无效分类拒绝且不写盘', async () => {
  const setup = await makeWorld();
  try {
    const ui = setup.world.webUi('zh');
    const before = await readDay(setup.dataDir, DAY);
    const home = await ui.invoke('today', 'list', []);
    assert.ok(home.today.items.every((item) => typeof item.displayCategory === 'string'));
    assert.deepEqual(await readDay(setup.dataDir, DAY), before);
    const target = addDays(DAY, 1);
    const payload = planPayload(target);
    payload.items[1].category = 'personal';
    assert.ok(!(await setup.tools.feast_life_plan(payload)).failed);
    assert.equal((await readDay(setup.dataDir, target)).items[1].category, 'personal');
    const bad = await setup.tools.feast_life_adjust({ date: target, start: '10:00', end: '11:00', activity: '上课', category: 'wrong' });
    assert.equal(bad.failed, true);
    const ok = await setup.tools.feast_life_adjust({ date: target, start: '10:00', end: '11:00', activity: '上课', category: 'personal' });
    assert.ok(!ok.failed, ok.text);
    assert.equal((await readDay(setup.dataDir, target)).items.find((it) => it.activity === '上课').category, 'personal');
    const categoryDay = await readDay(setup.dataDir, target);
    const book = categoryDay.items.find((it) => it.start === '09:00');
    book.detail = '保留这条细节'; book.outfit = '便装';
    await writeDay(setup.dataDir, categoryDay);
    await setup.tools.feast_life_adjust({ date: target, start: book.start, end: book.end, activity: book.activity, category: '' });
    const corrected = (await readDay(setup.dataDir, target)).items.find((it) => it.start === book.start);
    assert.equal(corrected.location, book.location);
    assert.equal(corrected.detail, book.detail);
    assert.equal(corrected.outfit, book.outfit);
    assert.equal(corrected.category, undefined);
    const old = await readDay(setup.dataDir, target);
    const badPlan = await setup.tools.feast_life_plan({ ...payload, items: payload.items.map((it) => ({ ...it, category: 'wrong' })) });
    assert.equal(badPlan.failed, true);
    assert.deepEqual(await readDay(setup.dataDir, target), old);
  } finally { await setup.world.stop(); }
});

test('补空闲仅主动发送、失败可重试、跨重启冷却；回应限邀请范围且保留其他安排和事实', async () => {
  const clock = { t: NOON };
  const setup = await makeWorld({ now: () => clock.t });
  let restart;
  try {
    const ui = setup.world.webUi('zh');
    assert.equal((await ui.invoke('today', 'fillFree', [])).ok, false);
    await ui.invoke('today', 'work', [{ work: false }]);
    const before = await readDay(setup.dataDir, DAY);
    assert.equal(setup.lifeEvents(EVENT_LIFE_PLAN).length, 0, '关闭上班不自动邀请');
    const home = await ui.invoke('today', 'list', []);
    assert.equal(home.fillFreeAvailable, true);
    assert.ok(home.freePlanSlots.every((slot) => slot.start >= '12:05'));
    const push = setup.host.pushEvent;
    setup.host.pushEvent = async () => { throw new Error('模拟发送失败'); };
    const failed = await ui.invoke('today', 'fillFree', []);
    assert.equal(failed.ok, false);
    assert.deepEqual(await readDay(setup.dataDir, DAY), before);
    setup.host.pushEvent = push;
    assert.equal((await ui.invoke('today', 'fillFree', [])).ok, true);
    const event = setup.lifeEvents(EVENT_LIFE_PLAN).at(-1);
    assert.equal(event.meta.reason, 'fill-free');
    assert.match(event.text, /不改其他计划/);
    assert.equal((await ui.invoke('today', 'fillFree', [])).ok, false);
    await setup.world.stop();
    restart = await makeWorld({ dataDir: setup.dataDir, now: () => clock.t });
    assert.equal((await restart.world.webUi().invoke('today', 'fillFree', [])).ok, false);
    const id = event.meta.requestId;
    const bad = await restart.tools.feast_life_adjust({ start: '20:00', end: '21:00', activity: '覆盖其他计划', fillRequest: id });
    assert.equal(bad.failed, true);
    const past = await restart.tools.feast_life_adjust({ start: '08:15', end: '09:00', activity: '改过去', fillRequest: id });
    assert.equal(past.failed, true);
    const workAgain = await restart.tools.feast_life_adjust({ start: '13:00', end: '14:00', activity: '继续上班', category: 'personal', fillRequest: id });
    assert.equal(workAgain.failed, true, '补空闲不应通过 personal 分类重新插入工作事件');
    const good = await restart.tools.feast_life_adjust({ start: '13:00', end: '14:00', activity: '读书', category: 'personal', fillRequest: id });
    assert.ok(!good.failed, good.text);
    const after = await readDay(setup.dataDir, DAY);
    assert.ok(after.items.some((it) => it.activity === '读书' && it.workFreed !== true));
    assert.deepEqual(after.items.filter((it) => it.start >= '18:45'), before.items.filter((it) => it.start >= '18:45'));
    const again = await restart.tools.feast_life_adjust({ start: '13:00', end: '14:00', activity: '覆盖新安排', fillRequest: id });
    assert.equal(again.failed, true);
    assert.deepEqual((await restart.world.webUi().invoke('today', 'list', [])).actual, []);
  } finally {
    await setup.world.stop();
    if (restart) await restart.world.stop();
  }
});

test('长期工作开关跨重启、跨工作日生效，固定上班日不能绕过，重开恢复', async () => {
  const setup = await makeWorld({ cfg: { lifeDayType: 'workday' } });
  const ui = setup.world.webUi();
  const before = await readDay(setup.dataDir, DAY);
  assert.ok(ui.panels.find((p) => p.id === 'today').getMethods.includes('workPolicy'));
  assert.equal((await ui.invoke('today', 'workPolicy', [{ enabled: false }])).ok, true);
  assert.deepEqual(await readDay(setup.dataDir, DAY), before);
  assert.equal((await ui.invoke('today', 'list', [])).workSchedulingEnabled, false);
  await setup.world.stop();
  const next = await makeWorld({ dataDir: setup.dataDir, now: () => Date.parse('2026-11-06T22:30:00+08:00'), cfg: { lifeDayType: 'workday' } });
  try {
    const today = await readDay(setup.dataDir, '2026-11-06');
    assert.equal(today.work, false);
    assert.ok(!['workday', 'overtime', 'slacking'].includes(today.dayType.id));
    assert.ok(!today.items.some((it) => /上班|加班|通勤/.test(it.activity)));
    const event = next.lifeEvents(EVENT_LIFE_PLAN).at(-1);
    assert.match(event.text, /持续关闭工作排程/);
    assert.ok(!['workday', 'overtime', 'slacking'].includes(event.meta.dayType));
    assert.equal((await next.world.webUi().invoke('today', 'list', [])).workSchedulingEnabled, false);
    assert.equal((await next.world.webUi().invoke('today', 'workPolicy', [{ enabled: true }])).ok, true);
  } finally { await next.world.stop(); }
  const resumed = await makeWorld({ dataDir: setup.dataDir, now: () => Date.parse('2026-11-09T12:05:00+08:00'), cfg: { lifeDayType: 'workday' } });
  try { assert.equal((await readDay(setup.dataDir, '2026-11-09')).work, true); }
  finally { await resumed.world.stop(); }
});

test('关闭工作排程：计划、伪装分类和单日开关不能重新插入工作，历史不追溯', async () => {
  const { world, tools, dataDir } = await makeWorld();
  try {
    await world.webUi().invoke('today', 'workPolicy', [{ enabled: false }]);
    const before = await readDay(dataDir, DAY);
    assert.equal((await tools.feast_life_day({ work: true })).failed, true);
    assert.equal((await tools.feast_life_adjust({ start: '15:00', end: '16:00', activity: '上班', category: 'personal' })).failed, true);
    assert.deepEqual(await readDay(dataDir, DAY), before);
    const ui = world.webUi();
    await ui.invoke('today', 'work', [{ work: false }]);
    assert.equal((await ui.invoke('today', 'work', [{ action: 'undo' }])).ok, false);
    await ui.invoke('today', 'plan', []);
    assert.match((await ui.invoke('today', 'day', ['tomorrow'])).day.dayType.id, /restday|outing|homebody/);
    const plan = planPayload(addDays(DAY, 1));
    assert.equal((await tools.feast_life_plan({ ...plan, dayType: '加班日' })).failed, true);
    assert.equal((await tools.feast_life_plan({ ...plan, items: [plan.items[0], { start: '09:00', end: '24:00', activity: '办公', category: 'personal' }] })).failed, true);
    assert.ok(!(await tools.feast_life_plan(plan)).failed);
    assert.equal((await readDay(dataDir, addDays(DAY, 1))).work, false);
    assert.ok(!(await tools.feast_life_plan({ ...planPayload('2026-11-04'), dayType: 'workday', work: true })).failed);
    await ui.storage.find((item) => item.key === 'feast-life').clear();
    assert.equal((await ui.invoke('today', 'list', [])).workSchedulingEnabled, false);
  } finally { await world.stop(); }
});

test('工作规则无日程也可设置；坏档报错且不能静默恢复上班', async () => {
  const { world, dataDir } = await makeWorld({ cfg: { lifeEnabled: false } });
  try {
    const ui = world.webUi();
    assert.equal((await ui.invoke('today', 'workPolicy', [{ enabled: 'false' }])).ok, false);
    assert.equal((await ui.invoke('today', 'workPolicy', [{ enabled: false }])).ok, true);
    await writeFile(join(dataDir, 'feast', 'work-policy.json'), '{broken', 'utf8');
    const state = await ui.invoke('today', 'list', []);
    assert.equal(state.workSchedulingError, true);
    assert.equal(state.workSchedulingEnabled, false);
    assert.ok(state.storageIssues.some((issue) => issue.key === 'workPolicy'));
    assert.equal((await ui.invoke('today', 'workPolicy', [{ enabled: true }])).ok, false);
  } finally { await world.stop(); }
});

test('首页提醒区分饭点来源、手动暂停，以及跨天后恢复', async () => {
  const clock = { t: NOON };
  const { world, tools, dataDir, events } = await makeWorld({ now: () => clock.t, cfg: { mealSlots: '23:30' } });
  try {
    const ui = world.webUi();
    const reminders = async () => (await ui.invoke('today', 'list', [])).reminders;
    assert.deepEqual((await reminders()).meal, { status: 'scheduled', slot: '23:30', source: 'config' });
    await tools.feast_life_day({ mealSlots: ['13:20'] });
    assert.deepEqual((await reminders()).meal, { status: 'scheduled', slot: '13:20', source: 'her' });
    await tools.feast_skip({ reason: '今天不想吃' });
    await tools.feast_life_skip({ reason: '今天不想被叫' });
    assert.deepEqual((await reminders()).meal, { status: 'paused', slot: '13:20', source: 'her' });
    assert.equal((await reminders()).free.status, 'paused');
    const tomorrow = addDays(DAY, 1);
    await writeDay(dataDir, templateDay(tomorrow, { now: clock.t, dayTypeId: 'restday' }));
    clock.t = Date.parse(`${tomorrow}T12:05:00+08:00`);
    assert.deepEqual((await reminders()).meal, { status: 'scheduled', slot: '23:30', source: 'config' });
    assert.notEqual((await reminders()).free.status, 'paused');
    assert.equal(events.length, 0, '首页读取不触发提醒');
  } finally { await world.stop(); }
});

test('首页试算容错内的提醒与饭点重试，不消耗档位或清除等待状态', async () => {
  const clock = { t: Date.parse(`${DAY}T11:45:00+08:00`) };
  const { world, dataDir, events, runTick } = await makeWorld({ now: () => clock.t,
    cfg: { lifeDayType: 'restday', mealSlots: '11:30', mealMaxRetries: 1, mealRetryMin: 40, lifeFreeSlots: '11:30,12:30' } });
  try {
    const reminders = async () => (await world.webUi().invoke('today', 'list', [])).reminders;
    const before = await readPlay(dataDir, DAY);
    for (let n = 0; n < 2; n += 1) {
      assert.deepEqual((await reminders()).meal, { status: 'due', slot: '11:30', source: 'config' });
      assert.deepEqual((await reminders()).free, { status: 'due', slot: '11:30', lastSkipped: null });
    }
    assert.equal(events.length, 0);
    assert.deepEqual(await readPlay(dataDir, DAY), before);
    await runTick();
    assert.equal(events.filter((event) => event.type === EVENT_MEAL).length, 1);
    assert.equal(events.filter((event) => event.type === EVENT_LIFE_FREE).length, 1);
    assert.equal((await reminders()).meal.status, 'waiting');
    assert.equal((await reminders()).meal.status, 'waiting');
    clock.t = Date.parse(`${DAY}T12:25:00+08:00`);
    assert.deepEqual((await reminders()).meal, { status: 'retry', slot: '11:30', source: 'config' });
    await runTick();
    assert.equal(events.filter((event) => event.type === EVENT_MEAL).length, 2);
    assert.equal((await reminders()).meal.status, 'finished');
  } finally { await world.stop(); }
});

test('首页补提醒、关闭与未排档状态遵守原调度规则', async () => {
  const { world, events } = await makeWorld({ now: () => Date.parse(`${DAY}T12:25:00+08:00`),
    cfg: { lifeDayType: 'restday', mealSlots: '11:30', lifeFreeSlots: '11:30,13:00' } });
  try {
    const reminders = async () => (await world.webUi().invoke('today', 'list', [])).reminders;
    assert.deepEqual((await reminders()).meal, { status: 'catchUp', slot: '11:30', source: 'config' });
    assert.deepEqual((await reminders()).free, { status: 'catchUp', slot: '补', lastSkipped: null });
    world.cfg.mealReminder = false;
    world.cfg.lifeFreeEnabled = false;
    assert.equal((await reminders()).meal.status, 'off');
    assert.equal((await reminders()).free.status, 'off');
    world.cfg.mealReminder = true;
    world.cfg.lifeFreeEnabled = true;
    world.cfg.mealSlots = '';
    world.cfg.lifeFreeSlots = '';
    assert.equal((await reminders()).meal.status, 'unconfigured');
    assert.equal((await reminders()).free.status, 'unconfigured');
    assert.equal(events.length, 0);
  } finally { await world.stop(); }
});

await report();
