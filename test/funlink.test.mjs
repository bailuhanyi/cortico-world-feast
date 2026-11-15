/**
 * 「她自己的时间」↔ 娱乐时间（cortico-world-fun）联动测试。
 *
 * 钉住五件事（这五条任何一条松了，用户就会看到指向不存在工具的例子）：
 *   1. 娱乐时间装了并启用 → 叫醒事件的例子里多那一行；
 *   2. 没装 / 没启用 / config 读不到 / config 坏 → 那一行整段不出现；
 *   3. `lifeFreeFunOn` 关掉 → 装了也不加；
 *   4. 用户自己在菜单里抄过 fun_* → 不重复加；
 *   5. 读 config 全程不抛错（抛错会把 World 卸载）。
 *
 * 宿主、定时器、时钟都是假的，照 life-world.test.mjs 的做法。
 * 临时目录故意不删：删目录会被沙箱当批量删除拦下。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { test, report } from './harness.mjs';
import { FeastWorld } from '../src/world.js';
import { DEFAULTS, EVENT_LIFE_FREE } from '../src/config.js';
import { FUN_LINE, funMenuLine, readFunEnabled, withFunLine } from '../src/life/funlink.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
await mkdir(TMP_ROOT, { recursive: true });

const TZ = 'Asia/Shanghai';
const DAY = '2026-11-05';
/**
 * 21:05 落在模板「上班日」的 19:45–23:00「自己的时间」里，默认那一档会叫醒她。
 * 别用 14:05——那时模板写的是「上班」，`#freeTick` 会按设计判成「不算她的自由时间」
 * 而不叫（那是 0.7.1 为了避免把休息硬塞给正在上班的她加的）。
 */
const FREE_SLOT = Date.parse(`${DAY}T21:05:00+08:00`);

/**
 * 造一个「数据目录」：`<root>/data/home/companion`。
 *
 * `readFunEnabled` 按 `<dataDir>/../config.json` 找（照 wardrobe.js 的 `readImggenRoot`），
 * 所以 config 要落在 `<root>/data/home/config.json`。真机就是这个形状：
 * `E:\Coopanion\data\home\companion` 是数据目录，config 在 `…\data\home\config.json`。
 */
async function makeDataDir(configWorlds = null) {
  const root = await mkdtemp(join(TMP_ROOT, 'funlink-'));
  const dataDir = join(root, 'data', 'home', 'companion');
  await mkdir(dataDir, { recursive: true });
  if (configWorlds !== null) {
    await writeFile(join(dataDir, '..', 'config.json'), JSON.stringify({ worlds: configWorlds }, null, 2), 'utf8');
  }
  return dataDir;
}

async function makeWorld({ now = () => FREE_SLOT, cfg = {}, dataDir } = {}) {
  const events = [];
  const ticks = [];
  const host = {
    log: { info() {}, warn() {}, debug() {} },
    async pushEvent(e, opts) {
      events.push({ ...e, opts });
      return { ...e, cursor: events.length };
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
      setTimeout: () => 1,
    },
  });
  await world.start(host);
  const tools = Object.fromEntries(world.tools().map((t) => [t.name, t.handler]));
  const runTick = async () => {
    for (const fn of ticks) await fn();
    await tools.feast_history({});
  };
  const freeEvents = () => events.filter((e) => e.type === EVENT_LIFE_FREE);
  return { world, host, events, tools, dataDir, runTick, freeEvents };
}

// --------------------------------------------------------------------------
// 纯函数
// --------------------------------------------------------------------------

test('funMenuLine：装了才给那一行，没装给空串', () => {
  assert.equal(funMenuLine('a\nb', true, {}), FUN_LINE);
  assert.equal(funMenuLine('a\nb', false, {}), '');
  assert.equal(funMenuLine('a\nb', true, { lifeFreeFunOn: false }), '');
});

test('funMenuLine：菜单里已经有 fun_* 就不再叠一条', () => {
  const menu = '- 出去玩（fun_go）';
  assert.equal(funMenuLine(menu, true, {}), '');
});

test('withFunLine：只追加，不改写用户原有的例子', () => {
  const menu = '- 出去转转\n- 发条动态';
  const out = withFunLine(menu, true, {});
  assert.ok(out.startsWith(menu), '原有内容必须原样保留在前面');
  assert.ok(out.endsWith(FUN_LINE));
  // 结尾空白会被收掉，别出现空行
  assert.ok(!/\n\n/.test(out), `不该出现空行：${JSON.stringify(out)}`);
  // 没装时原样返回
  assert.equal(withFunLine(menu, false, {}), menu);
});

test('withFunLine：空菜单也不会拼出以换行开头的东西', () => {
  assert.equal(withFunLine('', true, {}), FUN_LINE);
});

// --------------------------------------------------------------------------
// readFunEnabled：自动检测
// --------------------------------------------------------------------------

test('readFunEnabled：worlds.fun.enabled 是 true 才算装了', async () => {
  assert.equal(await readFunEnabled(await makeDataDir({ fun: { enabled: true } })), true);
  assert.equal(await readFunEnabled(await makeDataDir({ fun: { enabled: false } })), false);
  assert.equal(await readFunEnabled(await makeDataDir({ feast: { enabled: true } })), false);
});

test('readFunEnabled：没有 config.json 时返回 false，不抛错', async () => {
  assert.equal(await readFunEnabled(await makeDataDir(null)), false);
});

test('readFunEnabled：config.json 是坏 JSON 也返回 false，不抛错', async () => {
  const dataDir = await makeDataDir(null);
  await writeFile(join(dataDir, '..', 'config.json'), '{ 这不是 json', 'utf8');
  assert.equal(await readFunEnabled(dataDir), false);
});

// --------------------------------------------------------------------------
// 接缝：叫醒事件里到底有没有那一行
// --------------------------------------------------------------------------

test('装了娱乐时间：叫醒事件的例子里有「出门去逛逛」那一行', async () => {
  const dataDir = await makeDataDir({ fun: { enabled: true }, feast: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev, '这一档应该叫醒她');
  assert.ok(ev.text.includes('fun_go'), `例子里该有 fun_go：\n${ev.text}`);
  assert.ok(ev.text.includes('fun_home'), '例子里该有 fun_home');
  await world.stop();
});

test('没装娱乐时间：叫醒事件里绝不出现 fun_*', async () => {
  const dataDir = await makeDataDir({ feast: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev, '这一档应该叫醒她');
  assert.ok(!/fun_[a-z]+/.test(ev.text), `没装就不该提 fun_*：\n${ev.text}`);
  await world.stop();
});

test('装了但 worlds.fun.enabled 是 false：也不出现 fun_*', async () => {
  const dataDir = await makeDataDir({ fun: { enabled: false } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  assert.ok(!/fun_[a-z]+/.test(ev.text), `停用的世界不该出现在例子里：\n${ev.text}`);
  await world.stop();
});

test('lifeFreeFunOn 关掉：装了娱乐时间也不加那一行', async () => {
  const dataDir = await makeDataDir({ fun: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir, cfg: { lifeFreeFunOn: false } });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  assert.ok(!/fun_[a-z]+/.test(ev.text), `关掉开关就不该加：\n${ev.text}`);
  await world.stop();
});

test('用户自己抄过 fun_*：不重复加第二条', async () => {
  const dataDir = await makeDataDir({ fun: { enabled: true } });
  const menu = '- 出去转转\n- 去逛逛（fun_go 进门）';
  const { world, runTick, freeEvents } = await makeWorld({ dataDir, cfg: { lifeFreeMenu: menu } });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  const hits = ev.text.split('\n').filter((l) => l.includes('fun_go'));
  assert.equal(hits.length, 1, `该只有一条 fun_go，实际 ${hits.length} 条：\n${ev.text}`);
  await world.stop();
});

test('feast_life_start 回执也带那一行（不用等叫醒）', async () => {
  const dataDir = await makeDataDir({ fun: { enabled: true } });
  const { world, tools } = await makeWorld({ dataDir });
  const r = await tools.feast_life_start({});
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes('fun_go'), `feast_life_start 的回执也该带：\n${r.text}`);
  await world.stop();
});

test('feast_life_start：没装娱乐时间就不带', async () => {
  const dataDir = await makeDataDir(null);
  const { world, tools } = await makeWorld({ dataDir });
  const r = await tools.feast_life_start({});
  assert.ok(!r.failed, r.text);
  assert.ok(!/fun_[a-z]+/.test(r.text), `没装就不该带：\n${r.text}`);
  await world.stop();
});

await report();
