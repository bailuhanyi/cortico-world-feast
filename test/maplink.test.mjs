/**
 * 「她自己的时间」↔ 小地图（cortico-world-map）联动测试。
 *
 * 和 `funlink.test.mjs` **同构**——那 14 条钉住的五件事在这一边一模一样，
 * 只有 world id（`map`）和文案（`MAP_LINE`）不同：
 *   1. 小地图装了并启用 → 叫醒事件的例子里多那一行；
 *   2. 没装 / 没启用 / config 读不到 / config 坏 → 那一行整段不出现；
 *   3. `lifeFreeMapOn` 关掉 → 装了也不加；
 *   4. 用户自己在菜单里抄过 map_* → 不重复加；
 *   5. 读 config 全程不抛错（抛错会把 World 卸载）。
 *
 * 另外多钉两条这一边特有的：
 *   6. `MAP_LINE` 与 `FUN_LINE` **并存**、顺序固定、互不误判（`fun_` 与 `map_` 两个前缀）；
 *   7. 三处接线（叫醒事件 / `feast_life_start` / 面板 freeStart）走的是同一条路径。
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
import { FUN_LINE, withFunLine } from '../src/life/funlink.js';
import { MAP_LINE, mapMenuLine, readMapEnabled, withMapLine } from '../src/life/maplink.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
await mkdir(TMP_ROOT, { recursive: true });

const TZ = 'Asia/Shanghai';
const DAY = '2026-11-05';
/**
 * 21:05 落在模板「上班日」的 19:45–23:00「自己的时间」里，默认那一档会叫醒她。
 * 别用 14:05——那时模板写的是「上班」，`#freeTick` 会按设计判成「不算她的自由时间」
 * 而不叫（和 funlink.test.mjs 同一个坑）。
 */
const FREE_SLOT = Date.parse(`${DAY}T21:05:00+08:00`);

/**
 * 造一个「数据目录」：`<root>/data/home/companion`。
 *
 * `readMapEnabled` 按 `<dataDir>/../config.json` 找（照 wardrobe.js 的 `readImggenRoot`），
 * 所以 config 要落在 `<root>/data/home/config.json`。真机就是这个形状：
 * `E:\Coopanion\data\home\companion` 是数据目录，config 在 `…\data\home\config.json`。
 */
async function makeDataDir(configWorlds = null) {
  const root = await mkdtemp(join(TMP_ROOT, 'maplink-'));
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
  /** 面板「现在就想动」那一条通道。 */
  const ownerStart = () => world.webUi('zh').invoke('today', 'freeStart', []);
  return { world, host, events, tools, dataDir, runTick, freeEvents, ownerStart };
}

// --------------------------------------------------------------------------
// 纯函数
// --------------------------------------------------------------------------

test('mapMenuLine：装了才给那一行，没装给空串', () => {
  assert.equal(mapMenuLine('a\nb', true, {}), MAP_LINE);
  assert.equal(mapMenuLine('a\nb', false, {}), '');
  assert.equal(mapMenuLine('a\nb', true, { lifeFreeMapOn: false }), '');
});

test('mapMenuLine：菜单里已经有 map_* 就不再叠一条', () => {
  const menu = '- 四处走走（map_places）';
  assert.equal(mapMenuLine(menu, true, {}), '');
});

test('mapMenuLine：map_ 判据不误判 fun_*，反过来也一样', () => {
  // 只抄了娱乐时间那一行，不该挡住小地图这一行
  assert.equal(mapMenuLine(`- 出门（fun_go 进门）`, true, {}), MAP_LINE);
  // 只抄了小地图那一行，不该挡住娱乐时间那一行
  assert.equal(mapMenuLine('- 看看周围（map_look）', true, {}), '');
});

test('withMapLine：只追加，不改写用户原有的例子', () => {
  const menu = '- 出去转转\n- 发条动态';
  const out = withMapLine(menu, true, {});
  assert.ok(out.startsWith(menu), '原有内容必须原样保留在前面');
  assert.ok(out.endsWith(MAP_LINE));
  // 结尾空白会被收掉，别出现空行
  assert.ok(!/\n\n/.test(out), `不该出现空行：${JSON.stringify(out)}`);
  // 没装时原样返回
  assert.equal(withMapLine(menu, false, {}), menu);
});

test('withMapLine：空菜单也不会拼出以换行开头的东西', () => {
  assert.equal(withMapLine('', true, {}), MAP_LINE);
});

test('MAP_LINE 与 FUN_LINE 并存：两行都在，顺序固定为 fun 在前、map 在后', () => {
  const composed = withMapLine(withFunLine('', true, {}), true, {});
  const lines = composed.split('\n');
  assert.equal(lines.length, 2, `该正好两行：${JSON.stringify(composed)}`);
  assert.equal(lines[0], FUN_LINE);
  assert.equal(lines[1], MAP_LINE);
  // 互不误判：各自再拼一次不该再多出来
  assert.equal(withMapLine(withFunLine(composed, true, {}), true, {}), composed);
});

test('MAP_LINE 与 FUN_LINE 并存：一个没装时只加另一个', () => {
  assert.equal(withMapLine(withFunLine('', true, {}), false, {}), FUN_LINE);
  assert.equal(withMapLine(withFunLine('', false, {}), true, {}), MAP_LINE);
  assert.equal(withMapLine(withFunLine('', false, {}), false, {}), '');
});

// --------------------------------------------------------------------------
// readMapEnabled：自动检测
// --------------------------------------------------------------------------

test('readMapEnabled：worlds.map.enabled 是 true 才算装了', async () => {
  assert.equal(await readMapEnabled(await makeDataDir({ map: { enabled: true } })), true);
  assert.equal(await readMapEnabled(await makeDataDir({ map: { enabled: false } })), false);
  assert.equal(await readMapEnabled(await makeDataDir({ feast: { enabled: true } })), false);
  // 只认 map，别把别的 world 的 enabled 当自己
  assert.equal(await readMapEnabled(await makeDataDir({ fun: { enabled: true } })), false);
});

test('readMapEnabled：没有 config.json 时返回 false，不抛错', async () => {
  assert.equal(await readMapEnabled(await makeDataDir(null)), false);
});

test('readMapEnabled：config.json 是坏 JSON 也返回 false，不抛错', async () => {
  const dataDir = await makeDataDir(null);
  await writeFile(join(dataDir, '..', 'config.json'), '{ 这不是 json', 'utf8');
  assert.equal(await readMapEnabled(dataDir), false);
});

// --------------------------------------------------------------------------
// 接缝：叫醒事件里到底有没有那一行
// --------------------------------------------------------------------------

test('装了小地图：叫醒事件的例子里有「看看周围」那一行', async () => {
  const dataDir = await makeDataDir({ map: { enabled: true }, feast: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev, '这一档应该叫醒她');
  assert.ok(ev.text.includes('map_places'), `例子里该有 map_places：\n${ev.text}`);
  assert.ok(ev.text.includes('map_look'), '例子里该有 map_look');
  await world.stop();
});

test('没装小地图：叫醒事件里绝不出现 map_*', async () => {
  const dataDir = await makeDataDir({ feast: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev, '这一档应该叫醒她');
  assert.ok(!/map_[a-z]+/.test(ev.text), `没装就不该提 map_*：\n${ev.text}`);
  await world.stop();
});

test('装了但 worlds.map.enabled 是 false：也不出现 map_*', async () => {
  const dataDir = await makeDataDir({ map: { enabled: false } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  assert.ok(!/map_[a-z]+/.test(ev.text), `停用的世界不该出现在例子里：\n${ev.text}`);
  await world.stop();
});

test('lifeFreeMapOn 关掉：装了小地图也不加那一行', async () => {
  const dataDir = await makeDataDir({ map: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir, cfg: { lifeFreeMapOn: false } });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  assert.ok(!/map_[a-z]+/.test(ev.text), `关掉开关就不该加：\n${ev.text}`);
  await world.stop();
});

test('用户自己抄过 map_*：不重复加第二条', async () => {
  const dataDir = await makeDataDir({ map: { enabled: true } });
  const menu = '- 出去转转\n- 四处走走（map_places）';
  const { world, runTick, freeEvents } = await makeWorld({ dataDir, cfg: { lifeFreeMenu: menu } });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  const hits = ev.text.split('\n').filter((l) => l.includes('map_places'));
  assert.equal(hits.length, 1, `该只有一条 map_places，实际 ${hits.length} 条：\n${ev.text}`);
  await world.stop();
});

test('两个都装了：叫醒事件里两行都在，互不打架', async () => {
  const dataDir = await makeDataDir({ fun: { enabled: true }, map: { enabled: true } });
  const { world, runTick, freeEvents } = await makeWorld({ dataDir });
  await runTick();
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  assert.ok(ev.text.includes('fun_go'), `该有娱乐时间那一行：\n${ev.text}`);
  assert.ok(ev.text.includes('map_places'), `该有小地图那一行：\n${ev.text}`);
  // 顺序：fun 在前、map 在后
  assert.ok(ev.text.indexOf('fun_go') < ev.text.indexOf('map_places'), '两行顺序该是 fun 前 map 后');
  await world.stop();
});

// --------------------------------------------------------------------------
// 三处接线走同一条路径
// --------------------------------------------------------------------------

test('feast_life_start 回执也带那一行（不用等叫醒）', async () => {
  const dataDir = await makeDataDir({ map: { enabled: true } });
  const { world, tools } = await makeWorld({ dataDir });
  const r = await tools.feast_life_start({});
  assert.ok(!r.failed, r.text);
  assert.ok(r.text.includes('map_places'), `feast_life_start 的回执也该带：\n${r.text}`);
  await world.stop();
});

test('feast_life_start：没装小地图就不带', async () => {
  const dataDir = await makeDataDir(null);
  const { world, tools } = await makeWorld({ dataDir });
  const r = await tools.feast_life_start({});
  assert.ok(!r.failed, r.text);
  assert.ok(!/map_[a-z]+/.test(r.text), `没装就不该带：\n${r.text}`);
  await world.stop();
});

test('面板 freeStart 那条通道也带那一行（第三处接线）', async () => {
  const dataDir = await makeDataDir({ map: { enabled: true } });
  const { world, runTick, freeEvents, ownerStart } = await makeWorld({ dataDir });
  // 面板通道开头会现读一次，不必等 tick；但先跑一拍更接近真实时序。
  await runTick();
  const r = await ownerStart();
  assert.ok(r?.ok !== false, JSON.stringify(r));
  const ev = freeEvents().at(-1);
  assert.ok(ev, '面板该推一条');
  assert.ok(ev.text.includes('map_places'), `面板那条也该带：\n${ev.text}`);
  await world.stop();
});

test('面板 freeStart：没装小地图就不带', async () => {
  const dataDir = await makeDataDir(null);
  const { world, runTick, freeEvents, ownerStart } = await makeWorld({ dataDir });
  await runTick();
  const r = await ownerStart();
  assert.ok(r?.ok !== false, JSON.stringify(r));
  const ev = freeEvents().at(-1);
  assert.ok(ev);
  assert.ok(!/map_[a-z]+/.test(ev.text), `没装就不该带：\n${ev.text}`);
  await world.stop();
});

await report();
