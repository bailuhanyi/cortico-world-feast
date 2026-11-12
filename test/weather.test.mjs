/**
 * 0.7.3 天气：纯函数 + 默认关不提天气 + 注入天气后真的进前缀/事件/候选。
 *
 * 联网一律注入假的 fetchImpl，测试不碰真实网络（也不该碰：CI / 沙箱不一定出网）。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, report } from './harness.mjs';
import { FeastWorld } from '../src/world.js';
import { DEFAULTS } from '../src/config.js';
import {
  classifyWeather, weatherWord, weatherLine, weatherShort, weatherDishFilter,
  weatherPickHint, weatherFreeHint, fetchWeather, EMPTY_WEATHER,
} from '../src/weather.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
const TZ = 'Asia/Shanghai';
const NOON = Date.parse('2026-11-05T12:05:00+08:00');
const dirs = [];

/** 假的 open-meteo：第二次请求返回当前天气。 */
function fakeFetch({ code = 0, tempC = 31, isDay = 1, city = '上海' } = {}) {
  return async (url) => {
    if (url.includes('geocoding-api')) {
      return { ok: true, json: async () => ({ results: [{ name: city, latitude: 31.2, longitude: 121.4 }] }) };
    }
    return {
      ok: true,
      json: async () => ({ current: { weather_code: code, temperature_2m: tempC, is_day: isDay } }),
    };
  };
}

async function makeWorld({ cfg = {}, weatherFetch = null } = {}) {
  const dataDir = await mkdtemp(join(TMP_ROOT, 'weather-'));
  dirs.push(dataDir);
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
    now: () => NOON,
    random: () => 0.5,
    weatherFetch,
    timers: {
      setInterval: (fn) => { ticks.push(fn); return ticks.length; },
      clearInterval() {},
      setTimeout: () => 1,
    },
  });
  await world.start(host);
  const tools = Object.fromEntries(world.tools().map((t) => [t.name, t.handler]));
  return { world, tools, events, ticks, host };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test('WMO 码 → 中文词；未知码返回空串', () => {
  assert.equal(weatherWord(0), '晴');
  assert.equal(weatherWord(61), '小雨');
  assert.equal(weatherWord(95), '雷阵雨');
  assert.equal(weatherWord(999), '');
  assert.equal(weatherWord(undefined), '');
});

test('classifyWeather：热/晴/雨/冷/温和/ unknown', () => {
  assert.equal(classifyWeather({ code: 0, tempC: 31, isDay: 1 }), 'hot');
  assert.equal(classifyWeather({ code: 0, tempC: 25, isDay: 1 }), 'clear');
  assert.equal(classifyWeather({ code: 61, tempC: 18, isDay: 1 }), 'rain');
  assert.equal(classifyWeather({ code: 73, tempC: -2, isDay: 1 }), 'rain', '下雪也算雨那类');
  assert.equal(classifyWeather({ code: 3, tempC: 5, isDay: 1 }), 'cold');
  assert.equal(classifyWeather({ code: 3, tempC: 20, isDay: 1 }), 'mild');
  assert.equal(classifyWeather({ tempC: 20 }), 'unknown', '缺码不该瞎联动');
});

test('weatherLine / weatherShort：没数据一律空串（宁可不说也不编）', () => {
  assert.equal(weatherLine(null), '');
  assert.equal(weatherLine(EMPTY_WEATHER), '');
  assert.equal(weatherLine({ ok: false }), '');
  assert.equal(weatherLine({ ok: true, code: 999 }), '', '未知码不提天气');
  assert.equal(weatherShort(null), '');
  const snap = { ok: true, city: '上海', code: 0, tempC: 18.3, isDay: 1 };
  assert.match(weatherLine(snap), /上海.*晴.*18°C/);
  assert.equal(weatherShort(snap), '上海 晴 18°C');
  assert.match(weatherLine({ ok: true, code: 61, tempC: 12, isDay: 0 }), /夜里/);
});

test('weatherDishFilter：热偏清爽、雨偏热乎、温和不过滤', () => {
  const cool = weatherDishFilter('hot');
  const warm = weatherDishFilter('rain');
  assert.equal(weatherDishFilter('mild'), null);
  assert.equal(weatherDishFilter('unknown'), null);
  const dish = (category, keywords = [], name = '') => ({ category, keywords, name });
  assert.equal(cool(dish('饮品')), true);
  assert.equal(cool(dish('凉菜')), true);
  assert.equal(cool(dish('火锅')), false, '大太阳不推火锅');
  assert.equal(warm(dish('汤羹')), true);
  assert.equal(warm(dish('火锅')), true);
  assert.equal(warm(dish('饮品')), false, '下雨不推冰饮当主推');
  assert.match(weatherPickHint('hot'), /清爽/);
  assert.match(weatherPickHint('rain'), /热乎/);
  assert.equal(weatherPickHint('mild'), '');
  assert.match(weatherFreeHint('clear'), /日头足/);
  assert.match(weatherFreeHint('rain'), /伞/);
  assert.equal(weatherFreeHint('mild'), '');
});

test('fetchWeather：留空城市不联网；失败/乱填/抛错都返回 ok:false 且不抛', async () => {
  assert.deepEqual(await fetchWeather({ city: '' }), { ok: false });
  assert.deepEqual(await fetchWeather({ city: '   ' }), { ok: false });
  assert.deepEqual(await fetchWeather({ city: '上海', fetchImpl: fakeFetch() }), {
    ok: true, city: '上海', code: 0, tempC: 31, isDay: 1, kind: 'hot',
  });
  assert.deepEqual(await fetchWeather({ city: '上海', fetchImpl: () => { throw new Error('boom'); } }), { ok: false });
  assert.deepEqual(await fetchWeather({ city: '上海', fetchImpl: async () => ({ ok: false }) }), { ok: false });
  // geocoding 查不到城市 → 不再打第二个接口
  let calls = 0;
  const noGeo = async () => { calls += 1; return { ok: true, json: async () => ({ results: [] }) }; };
  assert.deepEqual(await fetchWeather({ city: '不存在的xyz', fetchImpl: noGeo }), { ok: false });
  assert.equal(calls, 1, '查不到城市不该再去打天气接口');
});

// ---------------------------------------------------------------------------
// 接进 World
// ---------------------------------------------------------------------------

test('默认关（没填城市）：envPromptVars 的天气块是空串，且不发任何网络请求', async () => {
  let calls = 0;
  const { world } = await makeWorld({ weatherFetch: async () => { calls += 1; throw new Error('不该联网'); } });
  const vars = world.envPromptVars();
  assert.equal(vars.feast_weather_block, '');
  assert.equal(calls, 0, '默认关时不该打天气接口');
  await world.stop();
});

test('开了天气但没填城市：依然不提天气、不联网', async () => {
  let calls = 0;
  const { world } = await makeWorld({
    cfg: { weatherEnabled: true },
    weatherFetch: async () => { calls += 1; throw new Error('不该联网'); },
  });
  assert.equal(world.envPromptVars().feast_weather_block, '');
  assert.equal(calls, 0);
  await world.stop();
});

test('填了城市 + 注入天气：前缀有天气块，饭点事件与候选都带天气', async () => {
  const MEAL = Date.parse('2026-11-05T11:35:00+08:00');
  const dataDir = await mkdtemp(join(TMP_ROOT, 'weather-meal-'));
  dirs.push(dataDir);
  const events = [];
  const ticks = [];
  const host = {
    log: { info() {}, warn() {}, debug() {} },
    async pushEvent(e, opts) { events.push({ ...e, opts }); return { ...e, cursor: events.length }; },
  };
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true, weatherEnabled: true, weatherCity: '上海' },
    dataDir, timezone: TZ, now: () => MEAL, random: () => 0.5,
    weatherFetch: fakeFetch({ code: 0, tempC: 31, isDay: 1 }),
    timers: {
      setInterval: (fn) => { ticks.push(fn); return ticks.length; },
      clearInterval() {}, setTimeout: () => 1,
    },
  });
  await world.start(host);
  const tools = Object.fromEntries(world.tools().map((t) => [t.name, t.handler]));

  assert.match(world.envPromptVars().feast_weather_block, /晴.*31°C/);
  // 不带筛选的菜单也该带清爽提示（走 #weatherPool）。
  assert.match((await tools.feast_menu({})).text, /清爽/);

  // 手动跑一拍 tick，让 11:35 那一档真的叫饭（start 的 2s setTimeout 被假定时器吞了）。
  for (const fn of ticks) await fn();
  await tools.feast_history({}); // 借一次工具把串行队列排空
  const meal = events.find((e) => e.type === 'feast.meal');
  assert.ok(meal, '到饭点该推一条 feast.meal');
  assert.match(meal.text, /外面这会儿：上海 晴 31°C/, '饭点正文里得有真实天气');
  assert.match(meal.text, /清爽/, '大太阳时饭点候选该偏清爽');
  await world.stop();
});

test('注入下雨天气：前缀/菜单提示都偏热乎，自由时间带伞', async () => {
  const { world, tools } = await makeWorld({
    cfg: { weatherEnabled: true, weatherCity: '上海' },
    weatherFetch: fakeFetch({ code: 61, tempC: 12, isDay: 1 }),
  });
  assert.match(world.envPromptVars().feast_weather_block, /小雨.*12°C/);
  const menu = await tools.feast_menu({});
  assert.match(menu.text, /热乎/, '下雨时随手给的几道该带热乎提示');
  const start = await tools.feast_life_start({ mood: '想出门' });
  assert.match(start.text, /伞|凉/, '下雨时自由时间该提醒带伞');
  await world.stop();
});

test('天气接口挂了：envPromptVars 仍是空串而不是抛错 / 编天气', async () => {
  const { world } = await makeWorld({
    cfg: { weatherEnabled: true, weatherCity: '上海' },
    weatherFetch: async () => { throw new Error('网络挂了'); },
  });
  assert.equal(world.envPromptVars().feast_weather_block, '', '取不到就一个字都不提');
  await world.stop();
});

await report();
for (const d of dirs) await rm(d, { recursive: true, force: true });
