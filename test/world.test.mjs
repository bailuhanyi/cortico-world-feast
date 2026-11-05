/**
 * World 的测试：挂载、六个工具、饭点事件、主人端菜、面板数据面、清库。
 *
 * 宿主是假的：只实现 log 和 pushEvent，把事件收进一个数组。
 * 定时器也是假的：把回调抓出来手动触发，不真的等 30 秒。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, report } from './harness.mjs';
import { FeastWorld } from '../src/world.js';
import { DEFAULTS } from '../src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
const TZ = 'Asia/Shanghai';
const NOON = Date.parse('2026-11-05T12:05:00+08:00');
const MEAL_TIME = Date.parse('2026-11-05T11:35:00+08:00');

const dirs = [];

async function makeWorld({ now = () => NOON, cfg = {} } = {}) {
  const dataDir = await mkdtemp(join(TMP_ROOT, 'w-'));
  dirs.push(dataDir);
  const events = [];
  const ticks = [];
  const timeouts = [];
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
      setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; },
    },
  });
  await world.start(host);
  const tools = Object.fromEntries(world.tools().map((t) => [t.name, t.handler]));
  /** 触发定时器那一拍，然后借一次工具调用把串行队列排空。 */
  const runTick = async () => {
    for (const fn of ticks) await fn();
    await tools.feast_history({});
  };
  return { world, host, events, tools, dataDir, runTick };
}

test('挂载：菜品库读进来了，六个工具都在', async () => {
  const { world, tools } = await makeWorld();
  assert.deepEqual(Object.keys(tools).sort(), [
    'feast_eat', 'feast_history', 'feast_menu', 'feast_reaction', 'feast_skip', 'feast_taste',
  ]);
  const menu = await tools.feast_menu({});
  assert.ok(menu.text.includes('库里共 80 道'), menu.text.slice(0, 80));
  assert.ok(menu.text.includes('川菜'));
  await world.stop();
});

test('feast_menu：筛选说得出找到了几道，说不通时不当掉', async () => {
  const { world, tools } = await makeWorld();
  const chuan = await tools.feast_menu({ cuisine: '川菜' });
  assert.ok(chuan.text.includes('找到 4 道'));
  assert.ok(chuan.text.includes('麻婆豆腐'));
  const none = await tools.feast_menu({ cuisine: '不存在的菜系' });
  assert.ok(none.text.includes('没有符合这个条件'), none.text);
  await world.stop();
});

test('feast_eat：给出这一口，并且真的记进账里', async () => {
  const { world, tools } = await makeWorld();
  const r = await tools.feast_eat({ dish: '麻婆豆腐' });
  assert.ok(!r.failed);
  assert.ok(r.text.includes('麻婆豆腐'));
  assert.ok(r.text.includes('口感：'));
  assert.ok(r.text.includes('feast_reaction'), '该提醒她记一句');

  const h = await tools.feast_history({});
  assert.ok(h.text.includes('吃过 1 回'));
  assert.ok(h.text.includes('今天：'));
  await world.stop();
});

test('feast_eat：同一道菜第二次吃，说的不一样', async () => {
  const { world, tools } = await makeWorld();
  const a = await tools.feast_eat({ dish: 'mapo-tofu' });
  const b = await tools.feast_eat({ dish: 'mapo-tofu' });
  assert.notEqual(a.text, b.text);
  const h = await tools.feast_history({});
  assert.ok(h.text.includes('麻婆豆腐×2'));
  await world.stop();
});

test('feast_eat：点名的菜不在库里时给候选，不硬吃', async () => {
  const { world, tools } = await makeWorld();
  const r = await tools.feast_eat({ dish: '佛跳墙炒饭' });
  assert.equal(r.failed, true);
  assert.ok(r.text.includes('没找到'));
  const h = await tools.feast_history({});
  assert.ok(h.text.includes('吃过 0 回'), '失败的那次不该记账');
  await world.stop();
});

test('feast_taste：只看不吃，不记账', async () => {
  const { world, tools } = await makeWorld();
  const r = await tools.feast_taste({ dish: 'tonkotsu-ramen' });
  assert.ok(r.text.includes('味道：'));
  const h = await tools.feast_history({});
  assert.ok(h.text.includes('吃过 0 回'));
  await world.stop();
});

test('feast_reaction：记一句，进画像', async () => {
  const { world, tools } = await makeWorld();
  await tools.feast_eat({ dish: '麻婆豆腐' });
  const r = await tools.feast_reaction({ action: 'like', note: '麻得正好，豆腐有点碎' });
  assert.ok(r.text.includes('合口味'));
  const bad = await tools.feast_reaction({ action: '很好吃' });
  assert.equal(bad.failed, true);
  const h = await tools.feast_history({});
  assert.ok(h.text.includes('麻得正好'));
  assert.ok(h.text.includes('口味画像'));
  await world.stop();
});

test('饭点：到点推一条 internal 事件，催一次之后放掉', async () => {
  const { world, events, runTick } = await makeWorld({ now: () => MEAL_TIME });
  await runTick();
  assert.equal(events.filter((e) => e.type === 'feast.meal').length, 1);
  const ev = events.find((e) => e.type === 'feast.meal');
  assert.equal(ev.origin, 'internal');
  assert.equal(ev.senderKey, 'feast-meal');
  assert.ok(ev.text.includes('11:30'));
  assert.ok(ev.text.includes('feast_eat'));
  assert.ok(ev.text.includes('feast_skip'));
  await world.stop();

  // 时钟自己走：41 分钟后催一次，再 41 分钟放掉。
  const clock = { t: MEAL_TIME };
  const { world: w2, events: e2, runTick: tick2 } = await makeWorld({ now: () => clock.t });
  await tick2();                                   // 11:35 → 叫
  assert.equal(e2.filter((e) => e.type === 'feast.meal').length, 1);
  clock.t += 41 * 60_000;                          // 12:16
  await tick2();                                   // → 催
  assert.equal(e2.filter((e) => e.type === 'feast.meal').length, 2);
  assert.ok(e2[1].text.includes('再问一句'));
  clock.t += 41 * 60_000;                          // 12:57
  await tick2();                                   // → 放掉，不再叫
  assert.equal(e2.filter((e) => e.type === 'feast.meal').length, 2);
  await w2.stop();
});

test('提醒开关关掉：一拍都不叫', async () => {
  const { world, events, runTick } = await makeWorld({ now: () => MEAL_TIME, cfg: { mealReminder: false } });
  await runTick();
  assert.equal(events.filter((e) => e.type === 'feast.meal').length, 0);
  await world.stop();
});

test('feast_skip：今天不再叫，第二天照常', async () => {
  const { world, events, tools, runTick } = await makeWorld({ now: () => MEAL_TIME });
  await tools.feast_skip({ reason: '不饿' });
  await runTick();
  assert.equal(events.filter((e) => e.type === 'feast.meal').length, 0);
  await world.stop();
});

test('主人端菜：推一条事件，接着吃到的就是端来的那道', async () => {
  const { world, events, tools } = await makeWorld();
  const r = await tools.feast_menu({});
  assert.ok(r.text);

  const served = await world.feedDish('creme-brulee');
  assert.equal(served.ok, true);
  const ev = events.find((e) => e.type === 'feast.feed');
  assert.ok(ev, '没推出 feast.feed');
  assert.equal(ev.origin, 'internal');
  assert.ok(ev.text.includes('焦糖布丁'));
  assert.ok(ev.text.includes('主人'));

  // 不带参数的 feast_eat 应该先吃端来的那道
  const ate = await tools.feast_eat({});
  assert.ok(ate.text.includes('焦糖布丁'), ate.text.slice(0, 60));
  assert.ok(ate.text.includes('主人端来的'));

  const h = await tools.feast_history({});
  assert.ok(h.text.includes('（主人端的）'));
  await world.stop();
});

test('主人端菜：端来的那道还写着她还剩多久', async () => {
  const clock = { now: MEAL_TIME };
  const { world, events, tools } = await makeWorld({ now: () => clock.now });
  await world.feedDish('mapo-tofu');
  const ev = events.find((e) => e.type === 'feast.feed');
  // 11:35 端的，默认留 30 分钟 → 12:05 之前吃掉都算数
  assert.ok(ev.text.includes('12:05'), `气泡里该写清到几点为止：${ev.text.split('\n').at(-1)}`);
  assert.ok(ev.text.includes('过了就收了'));

  clock.now += 10 * 60_000;
  const ate = await tools.feast_eat({});
  assert.ok(ate.text.includes('还剩约 20 分钟'), `吃的时候该知道还剩多久：${ate.text.split('\n').at(-1)}`);
  await world.stop();
});

test('主人端菜：快过期的那道，回执说得出只剩不到一分钟', async () => {
  const clock = { now: MEAL_TIME };
  const { world, tools } = await makeWorld({ now: () => clock.now });
  await world.feedDish('mapo-tofu');
  clock.now += 30 * 60_000 - 20_000;
  const ate = await tools.feast_eat({});
  assert.ok(ate.text.includes('不到一分钟'), ate.text.split('\n').at(-1));
  await world.stop();
});

test('主人端菜：端不存在的菜会被拒', async () => {
  const { world } = await makeWorld();
  const bad = await world.feedDish('no-such-dish');
  assert.equal(bad.ok, false);
  await world.stop();
});

test('面板数据面：菜单、单道、历史', async () => {
  const { world } = await makeWorld();
  const ui = world.webUi('zh');
  assert.deepEqual(ui.panels.map((p) => p.id), ['menu', 'history']);
  assert.ok(ui.panels[0].getMethods.includes('list'));
  assert.ok(!ui.panels[0].getMethods.includes('feed'), 'feed 是写操作，不该允许 GET');

  const list = await ui.invoke('menu', 'list', [{}]);
  assert.equal(list.total, 80);
  assert.ok(list.items.length >= 80);
  assert.ok(list.cuisines.includes('川菜'));

  const filtered = await ui.invoke('menu', 'list', [{ cuisine: '甜品' }]);
  assert.ok(filtered.items.every((d) => d.cuisine === '甜品'));

  const one = await ui.invoke('menu', 'dish', ['mapo-tofu']);
  assert.equal(one.ok, true);
  assert.equal(one.dish.name, '麻婆豆腐');
  assert.ok(one.dish.taste.麻 >= 70, `麻婆豆腐的麻只有 ${one.dish.taste.麻}`);

  const rand = await ui.invoke('menu', 'random', [{ cuisine: '粤菜' }]);
  assert.equal(rand.dish.cuisine, '粤菜');

  const fed = await ui.invoke('menu', 'feed', ['mapo-tofu']);
  assert.equal(fed.ok, true);
  assert.equal(fed.pending.id, 'mapo-tofu');
  const pending = await ui.invoke('menu', 'pending', []);
  assert.equal(pending.pending.name, '麻婆豆腐');

  const hist = await ui.invoke('history', 'list', []);
  assert.ok(hist.profile);

  await assert.rejects(() => ui.invoke('nope', 'list', []));
  await world.stop();
});

test('存下来的状态：重启之后还记得吃过什么', async () => {
  const { world, tools, dataDir } = await makeWorld();
  await tools.feast_eat({ dish: '麻婆豆腐' });
  await tools.feast_reaction({ action: 'like', note: '麻得正好' });
  await world.stop();

  const host = { log: { info() {}, warn() {} }, async pushEvent(e) { return { ...e, cursor: 1 }; } };
  const again = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true }, dataDir, timezone: TZ, now: () => NOON,
    timers: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1 },
  });
  await again.start(host);
  const h = await again.tools().find((t) => t.name === 'feast_history').handler({});
  assert.ok(h.text.includes('吃过 1 回'));
  assert.ok(h.text.includes('麻得正好'));
  await again.stop();
});

test('清库：吃过的记录没了，今天叫过的那几顿不会被重叫', async () => {
  const { world, tools, runTick, events } = await makeWorld({ now: () => MEAL_TIME });
  await tools.feast_eat({ dish: '麻婆豆腐' });
  await runTick();
  assert.equal(events.filter((e) => e.type === 'feast.meal').length, 1, '已叫过 11:30 这一档');

  const storage = world.webUi('zh').storage[0];
  assert.ok(storage.stat().includes('1 回'));
  const said = await storage.clear();
  assert.ok(typeof said === 'string');

  const h = await tools.feast_history({});
  assert.ok(h.text.includes('吃过 0 回'));
  await runTick();
  assert.equal(events.filter((e) => e.type === 'feast.meal').length, 1, '清了记录不该让她马上又被叫一次');
  await world.stop();
});

test('面板与配置声明齐全', async () => {
  const { world } = await makeWorld();
  const zh = world.webUi('zh');
  assert.equal(zh.label, '一桌菜');
  assert.ok(zh.config[0].schema.properties['worlds.feast.mealReminder'], '缺饭点开关');
  assert.ok(zh.config[0].schema.properties['worlds.feast.mealSlots']);
  assert.ok(zh.promptDocs[0].role === 'envPrompt');
  const desc = await import('../src/definition.js');
  assert.equal(desc.feastDefinition.id, 'feast');
  assert.equal(desc.feastDefinition.describe.tools.length, 6);
  assert.deepEqual(desc.feastDefinition.describe.events.map((e) => e.type), ['feast.meal', 'feast.feed']);
  await world.stop();
});

await report();
for (const d of dirs) await rm(d, { recursive: true, force: true });
