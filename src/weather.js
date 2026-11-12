/**
 * 食时 · 天气（0.7.3）。
 *
 * 解决的是「真机大太阳、她却说下雨」这种割裂：让鱼知道**此刻外面真实是什么天气**。
 *
 * 设计红线（别改回去）：
 *  · **城市是每个安装者各自填的**，不是代码常量、不自动探测 IP、不内置城市表。
 *    这是个发给所有人的 npm 包，写死任何一个城市对别人都是错的。
 *  · **留空 / 没填城市 / 联网失败 / 解析失败 → 返回 null，不提天气**。
 *    宁可不说天气，也绝不按季节编一个 —— 编出来的天气只是换个方式继续割裂。
 *  · 不爬天气网页的 HTML（改版就废），只用 open-meteo 的结构化 JSON：
 *      geocoding-api.open-meteo.com  （城市名 → 经纬度，中文可直接查）
 *      api.open-meteo.com           （经纬度 → 当前天气，免 Key、零注册）
 *  · 网络请求全在 fetchWeather() 里，且**绝不抛错**；World 只在 tick 里 await 它，
 *    envPromptVars() 是同步的，只读内存快照，不做网络。
 *
 * 本文件只依赖全局 fetch（Node >= 22.6，package.json engines 已要求）。
 */

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FCST_URL = 'https://api.open-meteo.com/v1/forecast';
/** 超时：挂在 tick 里，不能让一次联网卡住整个 World 的看表。 */
const TIMEOUT_MS = 6000;

/** WMO weather_code → 中文天气描述。open-meteo 的 current.weather_code 用这套码。 */
const WMO = {
  0: '晴',
  1: '大部晴朗', 2: '多云', 3: '阴',
  45: '有雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹',
};

/** 天气大类，用来选联动方向；unknown 不联动。 */
const KIND = {
  clear: 'clear', hot: 'hot', rain: 'rain', cold: 'cold', mild: 'mild',
};

/**
 * 把 WMO 码 + 温度 + 昼夜归成一类。纯函数，方便测试。
 * @returns {'clear'|'hot'|'rain'|'cold'|'mild'|'unknown'}
 */
export function classifyWeather({ code, tempC, isDay = 1 } = {}) {
  if (code === undefined || code === null || !Number.isFinite(Number(code))) return 'unknown';
  const c = Number(code);
  const t = Number.isFinite(Number(tempC)) ? Number(tempC) : null;
  const raining = (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99);
  const snowing = (c >= 71 && c <= 77) || (c >= 85 && c <= 86);
  if (raining || snowing) return 'rain';
  if (t !== null && t <= 8) return 'cold';
  if (t !== null && t >= 30) return 'hot';
  if (c === 0 || c === 1) return 'clear';
  return 'mild';
}

/**
 * 城市名是从 geocoding 回来的外部文本，最终要进系统前缀。
 * 宿主对前缀做 {{...}} 模板替换（见 life/inject.js 的 safe()），
 * 所以这里把花括号拆开，免得一个手滑填了「{{x}}」的城市被当成模板变量。
 */
function safeCity(s) {
  return String(s ?? '').replace(/\{\{/g, '{').replace(/\}\}/g, '}').slice(0, 40);
}

/** WMO 码 → 中文词。未知码返回空串（调用方据此不提天气）。纯函数。 */
export function weatherWord(code) {
  if (code === undefined || code === null) return '';
  return WMO[Number(code)] ?? '';
}

/**
 * 给模型看的一行天气。纯函数、同步、绝不抛错。
 * 返回 '' 表示「不提天气」（没数据 / 没填城市 / 联网失败都走这条）。
 *
 * @param {object|null} snap fetchWeather() 的快照，或内存里的旧快照
 */
export function weatherLine(snap, { who = '你' } = {}) {
  if (!snap || !snap.ok) return '';
  const word = weatherWord(snap.code);
  if (!word) return '';
  const bits = [];
  if (snap.city) bits.push(`${safeCity(snap.city)}这边`);
  bits.push(word);
  if (Number.isFinite(snap.tempC)) bits.push(`${Math.round(snap.tempC)}°C`);
  if (snap.isDay === 0) bits.push('这会儿是夜里');
  // 「你」是模型自己：别写成任务/天气报告，写成她抬眼能看到的背景。
  return `外面${bits.join('，')}。${who}聊到的时候，照眼睛看到的说就好，别报成天气预报。`;
}

/**
 * 天气联动方向 → 给 pickFew 的 pool 筛选谓词。纯函数。
 * 用现有的 category / keywords / taste 粗筛，**不改菜品契约**（DISH-SPEC 不许加字段）。
 *
 *  · hot / clear（大太阳、热）→ 偏冰饮、甜品、凉菜、清爽的
 *  · rain / cold（下雨、冷）→ 偏汤羹、火锅、热菜、热汤面
 *  · mild / unknown → 不过滤（返回 null，调用方不传 pool）
 *
 * 返回的是一个**宽松**谓词：宁可少联动，也不要把 800 道筛到只剩两三道。
 * @returns {((d:object)=>boolean)|null}
 */
export function weatherDishFilter(kind) {
  if (kind === 'hot' || kind === 'clear') {
    return (d) => {
      const cat = d.category;
      const kw = (d.keywords ?? []).join('');
      const name = d.name ?? '';
      return cat === '饮品' || cat === '甜品' || cat === '凉菜'
        || /冰|冻|凉|冷|爽|清|椰|果|茶|露|雪|刨|布丁|冻|酸梅|绿豆/.test(kw + name);
    };
  }
  if (kind === 'rain' || kind === 'cold') {
    return (d) => {
      const cat = d.category;
      const kw = (d.keywords ?? []).join('');
      const name = d.name ?? '';
      return cat === '汤羹' || cat === '火锅' || cat === '热菜'
        || /汤|炖|煲|烩|热|暖|锅|羹|面|粥|辣|姜|羊肉|涮/.test(kw + name);
    };
  }
  return null;
}

/** 天气联动时，饭点候选那行提示语。纯函数。 */
export function weatherPickHint(kind) {
  if (kind === 'hot' || kind === 'clear') return '（今天外面热，随手挑的都是清爽口的；想换别的照样能用 feast_menu。）';
  if (kind === 'rain' || kind === 'cold') return '（今天外面凉/下雨，随手挑的都是热乎的；想换别的照样能用 feast_menu。）';
  return '';
}

/** 天气联动时，自由时间例子后面搭的一句。纯函数。 */
export function weatherFreeHint(kind) {
  if (kind === 'hot' || kind === 'clear') return '外面日头足，想出门就挑凉快的时候、带瓶水。';
  if (kind === 'rain' || kind === 'cold') return '外面凉/下雨，出门记得加件衣裳、带把伞。';
  return '';
}

/** 和 weatherLine 同义但更短，给 feast_life_now 回执用。 */
export function weatherShort(snap) {
  if (!snap || !snap.ok) return '';
  const word = weatherWord(snap.code);
  if (!word) return '';
  const t = Number.isFinite(snap.tempC) ? ` ${Math.round(snap.tempC)}°C` : '';
  const city = snap.city ? `${safeCity(snap.city)} ` : '';
  return `${city}${word}${t}`;
}

/**
 * 唯一的联网函数：城市名 → 经纬度 → 当前天气。
 *
 * **绝不抛错**：任何失败都返回 `{ ok: false }`。调用方据此「不提天气」。
 * 支持注入 fetchImpl / timeoutMs 便于测试；生产用全局 fetch。
 *
 * @param {object} opts
 * @param {string} opts.city  用户填的城市名（中文即可），空 = 不请求
 * @param {string} [opts.timezone] 传给 open-meteo 的时区（只影响返回的时间串，不改数值）
 * @param {function} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ok:boolean, city?:string, code?:number, tempC?:number, isDay?:number, kind?:string}>}
 */
export async function fetchWeather({
  city = '', timezone = 'Asia/Shanghai', fetchImpl, timeoutMs = TIMEOUT_MS,
} = {}) {
  const name = String(city ?? '').trim();
  if (!name) return { ok: false };          // 默认关、留空即不提天气
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false };

  const getJson = async (url) => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    const geoUrl = `${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
    const geo = await getJson(geoUrl);
    const hit = Array.isArray(geo?.results) ? geo.results[0] : null;
    const lat = Number(hit?.latitude);
    const lon = Number(hit?.longitude);
    if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false };

    const fcstUrl = `${FCST_URL}?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,weather_code,is_day&timezone=${encodeURIComponent(timezone)}`;
    const data = await getJson(fcstUrl);
    const cur = data?.current;
    if (!cur) return { ok: false };
    const code = Number(cur.weather_code);
    const tempC = Number(cur.temperature_2m);
    const isDay = Number(cur.is_day);
    if (!Number.isFinite(code)) return { ok: false };
    return {
      ok: true,
      city: safeCity(hit.name || name),
      code,
      tempC: Number.isFinite(tempC) ? tempC : undefined,
      isDay: Number.isFinite(isDay) ? isDay : 1,
      kind: classifyWeather({ code, tempC, isDay }),
    };
  } catch {
    return { ok: false };
  }
}

/** 空快照常量：开关关着 / 还没刷到时用。和 wardrobe 的 emptyWardrobe 一个意思。 */
export const EMPTY_WEATHER = Object.freeze({ ok: false });
