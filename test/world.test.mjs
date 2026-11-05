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
import { FeastWorld, FEAST_TOOL_DECLS } from '../src/world.js';
import { loadDishes } from '../src/dishes.js';
import { DEFAULTS, EVENT_FEED, EVENT_MEAL, EVENT_TABLE, EVENT_TOGETHER } from '../src/config.js';

const lib = await loadDishes();

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
const TZ = 'Asia/Shanghai';
const NOON = Date.parse('2026-11-05T12:05:00+08:00');
const MEAL_TIME = Date.parse('2026-11-05T11:35:00+08:00');

const dirs = [];

async function makeWorld({ now = () => NOON, cfg = {}, dataDir: reuse = null } = {}) {
  // 给 dataDir 就复用（模拟"重启后读到同一个目录"）；不给就新开一个。
  const dataDir = reuse ?? await mkdtemp(join(TMP_ROOT, 'w-'));
  if (!reuse) dirs.push(dataDir);
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
  /** 触发定时器那一拍，然后借一次工具调用把串行队列排空。
*/
  const runTick = async () => {
    for (const fn of ticks) await fn();
    await tools.feast_history({});
  };
  return { world, host, events, tools, dataDir, runTick };
}

test('挂载：菜品库读进来了，工具都在（清单从声明算，不写死数量）', async () => {
  const { world, tools } = await makeWorld();
  const declared = FEAST_TOOL_DECLS.map((d) => d.name).sort();
  assert.deepEqual(Object.keys(tools).sort(), declared,
    '实际注册的工具和声明对不上');
  // 0.6.0 起有 8 个（新增 feast_combos / feast_combo）。
  for (const must of ['feast_eat', 'feast_menu', 'feast_combos', 'feast_combo']) {
    assert.ok(tools[must], `少了 ${must}`);
  }
  const menu = await tools.feast_menu({});
  assert.ok(menu.text.includes(`库里共 ${lib.dishes.length} 道`), menu.text.slice(0, 80));
  assert.ok(menu.text.includes('川菜'));
  await world.stop();
});

test('feast_menu：筛选说得出找到了几道，说不通时不当真', async () => {
  const { world, tools } = await makeWorld();
  const chuan = await tools.feast_menu({ cuisine: '川菜' });
  // 别写死数字：菜会一直加，跟库里实际数对上就行。
  const chuanCount = lib.dishes.filter((d) => d.cuisine === '川菜').length;
  assert.ok(chuan.text.includes(`找到 ${chuanCount} 道`), chuan.text.slice(0, 140));
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
  assert.ok(r.text.includes('feast_reaction'), '该提醒她记一次');

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

test('feast_eat：点名的菜不在库里时给候选，不硬凑', async () => {
  const { world, tools } = await makeWorld();
  const r = await tools.feast_eat({ dish: '佛跳墙炒饭' });
  assert.equal(r.failed, true);
  assert.ok(r.text.includes('没找到'));
  const h = await tools.feast_history({});
  assert.ok(h.text.includes('吃过 0 回'), '失败的那次不该记进去');
  await world.stop();
});

test('feast_taste：只看不吃，不记进账', async () => {
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
  await tick2();                                   // 11:35 → 叫一次
  assert.equal(e2.filter((e) => e.type === 'feast.meal').length, 1);
  clock.t += 41 * 60_000;                          // 12:16
  await tick2();                                   // 催一次
  assert.equal(e2.filter((e) => e.type === 'feast.meal').length, 2);
  assert.ok(e2[1].text.includes('再问一句'));
  clock.t += 41 * 60_000;                          // 12:57
  await tick2();                                   // 放掉，不再叫
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
  // 11:35 端的，默认留 30 分钟 → 12:05 之前吃掉都算数。
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

// --- 0.6.0：套餐 / 端一桌 ------------------------------------------------

test('feast_combos：列得出预设，每套现配出具体菜名', async () => {
  const { world, tools } = await makeWorld();
  const r = await tools.feast_combos({});
  assert.ok(r.text.includes('四菜一汤'), r.text.slice(0, 200));
  assert.ok(r.text.includes('现配：'), '该把每套配成具体菜名');
  assert.ok(r.text.includes('内置'), '该说清有几套是内置的');

  // resolve:false 只看名字，不列菜名。
  const brief = await tools.feast_combos({ resolve: false });
  assert.ok(!brief.text.includes('现配：'), '关掉 resolve 就不该列菜名');
  assert.ok(brief.text.includes('四菜一汤'));
  await world.stop();
});

test('feast_combo：开一桌，说清几道、摆上桌、推 feast.table 事件', async () => {
  const { world, events, tools } = await makeWorld();
  const r = await tools.feast_combo({ combo: '四菜一汤' });
  assert.ok(!r.failed, r.text ?? '');
  assert.ok(r.text.includes('四菜一汤'), r.text.slice(0, 120));
  assert.ok(r.text.includes('5 道'), `该说清几道：${r.text.slice(0, 120)}`);

  const ev = events.find((e) => e.type === 'feast.table');
  assert.ok(ev, '没推出 feast.table');
  assert.equal(ev.origin, 'internal');
  assert.ok(ev.text.includes('主人端来一桌菜'));
  assert.ok(ev.text.includes('5道'), `事件正文该写几道：${ev.text.slice(0, 120)}`);

  // 吃一道，回执说得出还剩哪几道。
  const ate = await tools.feast_eat({});
  assert.ok(ate.text.includes('还剩 4 道'), `该报进度：${ate.text.split('\n').at(-1)}`);
  await world.stop();
});

test('feast_combo：一桌吃到只剩最后一道，回执说「这一桌吃完了」', async () => {
  const { world, tools } = await makeWorld();
  await tools.feast_combo({ combo: '一个人吃' }); // 2 道
  const a = await tools.feast_eat({});
  assert.ok(a.text.includes('还剩 1 道'), a.text.split('\n').at(-1));
  const b = await tools.feast_eat({});
  assert.ok(b.text.includes('这一桌吃完了'), b.text.split('\n').at(-1));
  await world.stop();
});

test('feast_combo：不给 combo 就现配一桌，条数跟得上课配置', async () => {
  const { world, tools } = await makeWorld({ cfg: { ...DEFAULTS, enabled: true, comboSize: 3 } });
  const r = await tools.feast_combo({});
  assert.ok(!r.failed, r.text ?? '');
  assert.ok(r.text.includes('3 道'), `该按 comboSize 配 3 道：${r.text.slice(0, 120)}`);
  await world.stop();
});

test('feast_combo：不存在的套餐名，给出现有的，不硬端', async () => {
  const { world, events, tools } = await makeWorld();
  const r = await tools.feast_combo({ combo: '满汉全席' });
  assert.equal(r.failed, true, '不该端一套不存在的');
  assert.ok(r.text.includes('没有这套餐'));
  assert.ok(r.text.includes('四菜一汤'), '该告诉她现有哪些');
  assert.ok(!events.some((e) => e.type === 'feast.table'), '失败时不该推事件');
  await world.stop();
});

test('feast_combo：限了菜系，一桌都在那个菜系里', async () => {
  const { world, tools } = await makeWorld();
  const r = await tools.feast_combo({ size: 3, cuisine: '川菜' });
  assert.ok(!r.failed, r.text ?? '');
  // 正文每行都写着「菜名（菜系 · 类别）」，逐行核。
  const rows = r.text.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.ok(rows.length >= 2, `该配出几道：${r.text}`);
  for (const row of rows) assert.ok(row.includes('川菜'), `混进了别的菜系：${row}`);
  await world.stop();
});

test('套餐面板：list 给出预设和自定义，pick 现配不存', async () => {
  const { world } = await makeWorld();
  const ui = world.webUi('zh');
  const list = await ui.invoke('combo', 'list', [{}]);
  assert.ok(list.presets.length >= 8, `预设该有 8 套：${list.presets.length}`);
  assert.deepEqual(list.custom, [], '还没攒过，该是空的');
  assert.equal(list.max, 12);
  for (const p of list.presets) {
    assert.ok(p.name && p.size >= 1, `${p.id} 的数据不全`);
    assert.ok(Array.isArray(p.dishes) && p.dishes.length, `${p.name} 没现配出菜`);
    assert.ok(p.line, `${p.name} 缺一句口味话`);
  }

  const picked = await ui.invoke('combo', 'pick', [{ size: 2 }]);
  assert.equal(picked.ok, true);
  assert.equal(picked.combo.dishes.length, 2);
  // pick 只是看看，不该往她面前摆东西。
  const after = await ui.invoke('menu', 'pending', []);
  assert.equal(after.pending, null, 'pick 不该真的端过去');
  await world.stop();
});

test('套餐面板：攒一桌 → 存 → 重启后还在（走 combos.json，不走 state.json）', async () => {
  const { world, tools } = await makeWorld();
  const ui = world.webUi('zh');
  const save = await ui.invoke('combo', 'save', [{
    name: '我的周末桌',
    dishes: ['mapo-tofu', 'dongpo-pork'],
  }]);
  assert.equal(save.ok, true, save.message ?? '');
  assert.ok(save.combo.id, '该有个 id');
  assert.equal(save.combo.size, 2);

  const list = await ui.invoke('combo', 'list', [{}]);
  assert.equal(list.custom.length, 1);
  assert.equal(list.custom[0].name, '我的周末桌');

  // 换一个 World 实例（模拟重启）读同一个目录。
  const { world: again } = await makeWorld({ dataDir: world.dataDir });
  const list2 = await again.webUi('zh').invoke('combo', 'list', [{}]);
  assert.equal(list2.custom.length, 1, '重启后该还在');
  assert.deepEqual(list2.custom[0].picked, ['mapo-tofu', 'dongpo-pork'], '勾选要原样回来');

  // 自定义的桌也能端。
  const r = await again.webUi('zh').invoke('combo', 'serve', [{ id: save.combo.id }]);
  assert.equal(r.ok, true, r.message ?? '');
  assert.equal(r.dishes.length, 2);

  await world.stop();
  await again.stop();
});

test('套餐面板：清「吃过的记录」不会把攒的桌一起删了', async () => {
  const { world } = await makeWorld();
  const ui = world.webUi('zh');
  await ui.invoke('combo', 'save', [{ name: '要留住的桌', dishes: ['mapo-tofu'] }]);

  const st = world.webUi('zh').storage;
  assert.equal(st.length, 2, '该有「吃过的记录」和「主人攒的套餐」两项');
  const stateItem = st.find((s) => s.key === 'state');
  await stateItem.clear();

  const after = await world.webUi('zh').invoke('combo', 'list', [{}]);
  assert.equal(after.custom.length, 1, '清吃过的记录不该动自定义套餐');

  // 反过来，清套餐也不动吃过的记录。
  await st.find((s) => s.key === 'combos').clear();
  const gone = await world.webUi('zh').invoke('combo', 'list', [{}]);
  assert.equal(gone.custom.length, 0);
  const hist = await world.webUi('zh').invoke('history', 'list', []);
  assert.equal(typeof hist.total, 'number', '历史面板还该能用');
  await world.stop();
});

test('套餐面板：存一桌时坏输入被拦下，不写盘', async () => {
  const { world } = await makeWorld();
  const ui = world.webUi('zh');
  for (const [raw, why] of [
    [{ name: '', dishes: ['mapo-tofu'] }, '没名字'],
    [{ name: '空桌', dishes: [] }, '没菜'],
    [{ name: '重复', dishes: ['mapo-tofu', 'mapo-tofu'] }, '重复'],
    [{ name: '库里没有', dishes: ['no-such-dish'] }, '库外 id'],
  ]) {
    const r = await ui.invoke('combo', 'save', [raw]);
    assert.equal(r.ok, false, `${why} 该被拦住`);
    assert.ok(r.message, `${why} 该说清原因`);
  }
  const list = await ui.invoke('combo', 'list', [{}]);
  assert.equal(list.custom.length, 0, '一条都不该存下来');
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
  assert.deepEqual(ui.panels.map((p) => p.id), ['menu', 'combo', 'history']);
  assert.ok(ui.panels[0].getMethods.includes('list'));
  assert.ok(!ui.panels[0].getMethods.includes('feed'), 'feed 是写操作，不该允许 GET');

  const list = await ui.invoke('menu', 'list', [{}]);
  assert.equal(list.total, lib.dishes.length);
  assert.ok(list.items.length >= lib.dishes.length);
  assert.ok(list.cuisines.includes('川菜'));
  // 面板是「先形态、后菜系」：每个类别要带出它自己那一份菜系名单。
  assert.ok(list.categoryCuisines?.['汤羹']?.length > 0, '汤羹下面该有菜系可筛');
  assert.ok(!list.categoryCuisines['汤羹'].includes('甜品'), '甜品里没有汤羹，不该出现在汤羹的菜系名单里');

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
  assert.equal(events.filter((e) => e.type === 'feast.meal').length, 1, '已叫过 11:30 这一顿');

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

// ---------------------------------------------------------------------------
// 陪主人吃饭
// ---------------------------------------------------------------------------

/** 面板方法都挂在菜单面板上（不新增面板）。
*/
const panel = (world, method, args = []) => world.webUi('zh').invoke('menu', method, args);

test('一起吃饭：主人邀请她 → 开席 + 推一条 invite；她已经挂着邀请时不能再开席', async () => {
  const { world, events } = await makeWorld();
  const inv = await world.inviteTogether();
  assert.equal(inv.ok, true, inv.message);
  assert.equal(inv.together.active, true);
  assert.equal(inv.together.starter, 'owner');

  const ev = events.find((e) => e.type === 'feast.together');
  assert.ok(ev, '没推出 feast.together');
  assert.equal(ev.origin, 'internal');
  assert.equal(ev.meta.kind, 'invite');
  assert.ok(ev.text.includes('一起'), ev.text.slice(0, 80));

  const again = await world.inviteTogether();
  assert.equal(again.ok, false, '正在一起吃的时候不该再开一次席');
  await world.stop();
});

test('一起吃饭：她邀请主人只挂待回应、**不发事件**，而且回执催她自己开口', async () => {
  const { world, events, tools } = await makeWorld();
  const r = await tools.feast_together({ action: 'invite' });
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes('聊天'), `该教她自己说出口：${r.text}`);
  assert.ok(r.text.includes('不'), r.text);
  assert.ok(!events.some((e) => e.type === 'feast.together'), '她邀请主人不该推事件（没有那个通道）');

  const tog = (await panel(world, 'together')).together;
  assert.ok(tog.invite, '面板上该挂着一条待回应');
  assert.ok(tog.invite.leftMin > 0, '该告诉主人还剩几分钟');

  // 已经挂着一条时再邀请：如实拒绝，且不偷偷多记一次
  const again = await tools.feast_together({ action: 'invite' });
  assert.equal(again.failed, true);
  assert.ok(again.text.includes('等'), again.text);
  await world.stop();
});

test('一起吃饭：她自己一天最多主动邀请两次，用完如实拒绝，跨天又是新的', async () => {
  let t = NOON;
  const { world, tools, events } = await makeWorld({ now: () => t, cfg: { togetherMaxInvites: 2 } });

  assert.ok(!(await tools.feast_together({ action: 'invite' })).failed);
  await panel(world, 'decline');            // 主人收掉这条（不占新名额）
  assert.ok(!(await tools.feast_together({ action: 'invite' })).failed);
  await panel(world, 'decline');
  const third = await tools.feast_together({ action: 'invite' });
  assert.equal(third.failed, true, '今天的名额用完了');
  assert.ok(third.text.includes('2'), `该说清上限：${third.text}`);

  // 换成第二天：又是新的
  t = NOON + 24 * 3600_000;
  const tomorrow = await tools.feast_together({ action: 'invite' });
  assert.ok(!tomorrow.failed, `跨天该重新有两次：${tomorrow.text}`);
  assert.ok(!events.some((e) => e.type === 'feast.together'), '她邀请主人始终不该推事件');
  await world.stop();
});

test('一起吃饭：喂一口走上桌事件，正文是「这一口」的样子，而且一口不等于一道', async () => {
  const { world, events, tools } = await makeWorld();
  await world.inviteTogether();
  const dish = lib.dishes[0];
  const bite = await world.biteTogether(dish.id);
  assert.equal(bite.ok, true, bite.message);

  const evs = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'bite');
  assert.equal(evs.length, 1, `该推一条 bite：${events.map((e) => e.meta?.kind).join(',')}`);
  assert.ok(evs[0].text.includes(dish.name), evs[0].text.slice(0, 120));
  assert.ok(evs[0].text.length > 60, '正文该带上这一口的描写');
  assert.equal(bite.together.biteCount, 1);

  // 同一道再喂一口：nth 接着数（第几口说得不一样），但仍不算"吃掉一道"
  const second = await world.biteTogether(dish.id);
  assert.equal(second.together.biteCount, 2, '同一道喂了两口');
  assert.equal(second.together.active, true, '喂一口不该把这一顿结束');

  // 她"吃过"，但桌上没有因为这一口少菜：feast_eat 仍能吃端来的那道
  const hist = await tools.feast_history({});
  assert.ok(hist.text.includes(dish.name), hist.text.slice(0, 120));
  assert.ok(hist.text.includes('喂的一口'), `吃过记录该标出是喂的：${hist.text.slice(0, 200)}`);
  await world.stop();
});

test('一起吃饭：主人自己吃什么——库里点一道给菜名，写的那句正好是菜名也按库里那道记', async () => {
  const { world, events } = await makeWorld();
  await world.inviteTogether();
  const dish = lib.dishes[0];

  const r1 = await world.takeTogether({ id: dish.id });
  assert.equal(r1.ok, true, r1.message);
  const ev1 = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'owner-ate').at(-1);
  assert.ok(ev1.text.includes(dish.name), ev1.text.slice(0, 120));
  assert.ok(!ev1.text.includes('没进库'), '库里点的那道不该说"没进库"');

  // 写的那句**正好**是库里一道菜的名字：不该回一句"库里没有"
  const r2 = await world.takeTogether({ note: dish.name });
  assert.equal(r2.ok, true, r2.message);
  const ev2 = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'owner-ate').at(-1);
  assert.ok(ev2.text.includes(dish.name), ev2.text.slice(0, 120));
  assert.ok(ev2.text.includes(dish.cuisine), `按库里那道记就该带上菜系：${ev2.text.slice(0, 160)}`);
  assert.ok(!ev2.text.includes('库里没有'), `库里有的菜名不能说"库里没有"：${ev2.text.slice(0, 200)}`);
  assert.ok(!ev2.text.includes('没进库'), `对上了就不算自由文本：${ev2.text.slice(0, 200)}`);
  const v = (await panel(world, 'together')).together;
  assert.equal(v.ownerAte[0].kind, 'dish', '面板上该记成库里那道');
  assert.equal(v.ownerAte[0].id, dish.id);

  // 用 id 写也一样
  const r3 = await world.takeTogether({ note: dish.id });
  assert.ok((await panel(world, 'together')).together.ownerAte[0].kind === 'dish', 'id 也该认');
  assert.equal(r3.ok, true, r3.message);

  await world.stop();
});

test('一起吃饭：写的那句不是菜名才按自由文本记，而且只认精确匹配（不做模糊）', async () => {
  const { world, events } = await makeWorld();
  await world.inviteTogether();

  const r = await world.takeTogether({ note: '在啃面包' });
  assert.equal(r.ok, true, r.message);
  const ev = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'owner-ate').at(-1);
  assert.ok(ev.text.includes('在啃面包'), ev.text.slice(0, 120));
  // 不变式 6：这条只按他说的写，别拿库里别的菜替他形容。
  assert.ok(ev.text.includes('没进库'), `自由文本要如实说明没进库：${ev.text.slice(0, 200)}`);
  assert.ok(ev.text.includes('别拿库里别的菜'), ev.text.slice(0, 200));
  const v = (await panel(world, 'together')).together;
  assert.equal(v.ownerAte[0].kind, 'note');
  assert.equal(v.ownerAte[0].note, '在啃面包');

  // 「面包」是库里好几道菜名的一部分，但自由文本**不做模糊匹配**：
  // 把"在啃面包"当成"蒜香面包"就是替他编（这是 findDishExact 存在的理由）。
  const partial = await world.takeTogether({ note: '面包' });
  assert.equal(partial.ok, true, partial.message);
  assert.equal((await panel(world, 'together')).together.ownerAte[0].kind, 'note',
    '名字的一部分不算命中');

  const bad = await world.takeTogether({});
  assert.equal(bad.ok, false, '什么都没说就不该记');
  await world.stop();
});

test('一起吃饭：她分主人一口只记 gesture，不进她自己的吃过记录，也不推事件', async () => {
  const { world, events, tools } = await makeWorld();
  const dish = lib.dishes[1];
  const r = await tools.feast_together({ action: 'feed', dish: dish.id });
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes(dish.name), r.text);

  const v = (await panel(world, 'together')).together;
  assert.ok(v, '面板该给出这一顿');
  assert.equal(v.backPending.id, dish.id, '面板上该看见她分过来的那口');

  const hist = await tools.feast_history({});
  assert.ok(!hist.text.includes(dish.name), `回喂不是她吃，不该进她自己的账：${hist.text.slice(0, 200)}`);
  assert.ok(!events.some((e) => e.type === 'feast.together' && e.meta.kind === 'feed'), '她这边扣的动作没有事件');

  // 主人回应：接过来 → 推一条 back，让**她**知道
  const ok = await world.replyTogether(true);
  assert.equal(ok.ok, true, ok.message);
  const ev = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'back').at(-1);
  assert.ok(ev, '接住了要告诉她');
  assert.equal(ev.meta.accepted, true);
  assert.ok(ev.text.includes(dish.name), ev.text.slice(0, 120));

  const none = await world.replyTogether(false);
  assert.equal(none.ok, false, '没有等着回应的那条了');
  await world.stop();
});

test('一起吃饭：接住她的邀请会开席并告诉她；「今天不了」只是收条子、不推事件', async () => {
  const { world, events, tools } = await makeWorld();
  await tools.feast_together({ action: 'invite' });
  const acc = await world.acceptTogether();
  assert.equal(acc.ok, true, acc.message);
  assert.equal(acc.together.active, true);
  assert.equal(acc.together.starter, 'her', '这顿是她起的头');

  const ev = events.filter((e) => e.type === 'feast.together').at(-1);
  assert.equal(ev.meta.kind, 'invite');
  assert.equal(ev.meta.accepted, true);
  assert.ok(ev.text.includes('应'), `该告诉她主人应了：${ev.text.slice(0, 80)}`);
  await world.stop();
});

test('一起吃饭：她先收摊 / 主人散桌，都记下为什么', async () => {
  const { world, events, tools } = await makeWorld();
  await world.inviteTogether();
  const end = await world.endTogether();
  assert.equal(end.ok, true, end.message);
  assert.equal(end.together.active, false);
  assert.equal(end.together.lastEnd.why, 'owner');
  const ev = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'end').at(-1);
  assert.ok(ev, '散桌要告诉她');
  assert.ok(ev.text.includes('散'), ev.text.slice(0, 80));

  // 她那边收：不发事件（面板轮询看得到）
  await world.inviteTogether();
  const before = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'end').length;
  const her = await tools.feast_together({ action: 'end' });
  assert.ok(!her.failed, her.text);
  assert.equal(events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'end').length, before);
  await world.stop();
});

test('一起吃饭：到点自己散桌（主人没点、她也忘了），并告诉她一声', async () => {
  let t = NOON;
  const { world, events, runTick } = await makeWorld({ now: () => t, cfg: { togetherTTLMin: 5 } });
  await world.inviteTogether();
  t = NOON + 6 * 60_000;
  await runTick();

  const v = (await panel(world, 'together')).together;
  assert.equal(v.active, false, '到点该自己散桌');
  assert.equal(v.lastEnd.why, 'ttl');
  const ev = events.filter((e) => e.type === 'feast.together' && e.meta.kind === 'end').at(-1);
  assert.ok(ev, '到点收摊也该告诉她一声');
  assert.equal(ev.meta.why, 'ttl');
  await world.stop();
});

test('一起吃饭：她的那份吃完就自动散桌（刚吃过的那道已经说了"这一桌吃完了"，不再另发一条）', async () => {
  let t = NOON;
  const { world, events, tools, runTick } = await makeWorld({ now: () => t });
  await world.inviteTogether();
  await world.feedDish(lib.dishes[0].id);   // 桌上摆一道（复用 served）
  await tools.feast_eat({});                // 吃掉这唯一一道

  t = NOON + 60_000;
  await runTick();
  const v = (await panel(world, 'together')).together;
  assert.equal(v.active, false, '她那份吃完了，这顿就该散');
  assert.equal(v.lastEnd.why, 'finished');
  assert.ok(!events.some((e) => e.type === 'feast.together' && e.meta.kind === 'end'),
    '吃完了不重复推一条（她刚在吃菜的回执里看到了）');
  await world.stop();
});

test('一起吃饭：没开席时，喂/自己吃/摊牌这几件事都不该静默地做出效果', async () => {
  const { world } = await makeWorld();
  const dish = lib.dishes[0];
  assert.equal((await world.biteTogether(dish.id)).ok, false, '没开席不该能喂');
  assert.equal((await world.takeTogether({ note: '在啃面包' })).ok, false, '没开席不该能记自己吃的');
  assert.equal((await world.endTogether()).ok, false, '没开席没什么可散的');
  assert.equal((await world.replyTogether(true)).ok, false, '她还没分过什么');
  assert.equal((await world.acceptTogether()).ok, false, '她没有挂着邀请');
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
  // 工具数从声明算：加工具时这里不该再红一次。
  assert.equal(desc.feastDefinition.describe.tools.length, FEAST_TOOL_DECLS.length,
    'describe 里的工具数和声明对不上（跑 node tools/make-describe.mjs 重生）');
  // 事件清单也从常量算：再加事件时这里不该再红一次（不变式 3）。
  assert.deepEqual(desc.feastDefinition.describe.events.map((e) => e.type),
    [EVENT_MEAL, EVENT_FEED, EVENT_TABLE, EVENT_TOGETHER],
    'describe 里的事件和 config.js 声明的对不上');
  await world.stop();
});

await report();
for (const d of dirs) await rm(d, { recursive: true, force: true });
