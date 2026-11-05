/**
 * 菜品库：加载、查找、筛选、随机、口味画像。
 *
 * 数据是 src/data/*.json，一个菜系组一个文件，每个文件是一个菜品数组。
 * 契约（字段名、取值范围）由 tools/validate-dishes.mjs 守着，这里运行期只做防御性检查：
 * 库里有一条坏数据不该让整个 World 起不来，所以坏的那条丢掉并记一行日志。
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

export const TASTE_FIELDS = ['辣', '麻', '咸', '鲜', '甜', '酸', '苦', '油', '香'];
export const CATEGORIES = ['热菜', '凉菜', '主食', '汤羹', '面点', '小吃', '甜品', '饮品', '烧烤', '火锅'];

/** 一次加载，进程内复用。 */
let cache = null;

function isDish(d) {
  return !!d && typeof d === 'object' && typeof d.id === 'string' && d.id.trim()
    && typeof d.name === 'string' && d.name.trim()
    && !!d.taste && typeof d.taste === 'object';
}

/** 补齐可能缺的可选字段，返回规范化后的菜品。 */
function normalizeDish(d) {
  const taste = {};
  for (const k of TASTE_FIELDS) {
    const n = Number(d.taste?.[k]);
    taste[k] = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
  }
  return {
    id: String(d.id),
    name: String(d.name),
    alias: typeof d.alias === 'string' ? d.alias : '',
    cuisine: typeof d.cuisine === 'string' && d.cuisine ? d.cuisine : '未分类',
    category: typeof d.category === 'string' && d.category ? d.category : '热菜',
    region: typeof d.region === 'string' ? d.region : '',
    ingredients: Array.isArray(d.ingredients) ? d.ingredients.filter((x) => typeof x === 'string' && x.trim()) : [],
    method: typeof d.method === 'string' ? d.method : '',
    serving: typeof d.serving === 'string' ? d.serving : '',
    taste,
    texture: typeof d.texture === 'string' ? d.texture : '',
    aroma: typeof d.aroma === 'string' ? d.aroma : '',
    finish: typeof d.finish === 'string' ? d.finish : '',
    prose: typeof d.prose === 'string' ? d.prose : '',
    keywords: Array.isArray(d.keywords) ? d.keywords.filter((x) => typeof x === 'string' && x.trim()) : [],
  };
}

/**
 * 读整个菜品库。坏文件/坏条目跳过，不抛。
 * 返回 { dishes, byId, cuisines, categories, bad }
 */
export async function loadDishes(logger) {
  if (cache) return cache;
  const dishes = [];
  const seen = new Set();
  let bad = 0;

  let files = [];
  try {
    files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    logger?.warn?.(`一桌菜：菜品目录读不到（${err?.message ?? err}）`);
  }

  for (const file of files) {
    let arr;
    try {
      arr = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8'));
    } catch (err) {
      bad += 1;
      logger?.warn?.(`一桌菜：${file} 解析失败，跳过 —— ${err?.message ?? err}`);
      continue;
    }
    if (!Array.isArray(arr)) {
      bad += 1;
      logger?.warn?.(`一桌菜：${file} 顶层不是数组，跳过`);
      continue;
    }
    for (const raw of arr) {
      if (!isDish(raw)) { bad += 1; continue; }
      const dish = normalizeDish(raw);
      if (seen.has(dish.id)) { bad += 1; continue; }
      seen.add(dish.id);
      dishes.push(dish);
    }
  }

  const byId = new Map(dishes.map((d) => [d.id, d]));
  const cuisines = [...new Set(dishes.map((d) => d.cuisine))].sort();
  const categories = CATEGORIES.filter((c) => dishes.some((d) => d.category === c));

  cache = { dishes, byId, cuisines, categories, bad };
  return cache;
}

/** 单测/重载用：丢掉缓存。 */
export function resetDishCache() {
  cache = null;
}

/** 按 id、名字或别名找一道菜。找不到返回 null。 */
export function findDish(lib, ref) {
  if (!ref) return null;
  const q = String(ref).trim();
  if (!q) return null;
  const lower = q.toLowerCase();

  const byIdExact = lib.byId.get(q);
  if (byIdExact) return byIdExact;

  const nameExact = lib.dishes.find((d) => d.name === q);
  if (nameExact) return nameExact;

  const aliasExact = lib.dishes.find((d) => d.alias && d.alias.toLowerCase() === lower);
  if (aliasExact) return aliasExact;

  // 模糊：她说的比库里短（「麻婆豆腐」对上「陈麻婆豆腐」）就算。
  // 反过来不算：她点「佛跳墙炒饭」时把「佛跳墙」端上去，是替她改了主意。
  const partial = lib.dishes.filter((d) => d.name.includes(q)
    || (d.alias && d.alias.toLowerCase().includes(lower)) || d.id.includes(lower));
  if (partial.length === 1) return partial[0];
  // 多个候选时取名字最长的（最具体的那个）。
  if (partial.length > 1) return partial.slice().sort((a, b) => b.name.length - a.name.length)[0];
  return null;
}

/** 按菜系/类别/关键词/自由词筛。全部为空则不筛。 */
export function filterDishes(lib, { cuisine, category, keyword, query } = {}) {
  let out = lib.dishes;
  if (cuisine) {
    const c = String(cuisine).trim();
    out = out.filter((d) => d.cuisine === c || d.cuisine.includes(c) || c.includes(d.cuisine));
  }
  if (category) {
    const c = String(category).trim();
    out = out.filter((d) => d.category === c);
  }
  if (keyword) {
    const k = String(keyword).trim();
    out = out.filter((d) => d.keywords.some((x) => x.includes(k) || k.includes(x)));
  }
  if (query) {
    const q = String(query).trim();
    if (q) {
      out = out.filter((d) => d.name.includes(q) || d.alias.toLowerCase().includes(q.toLowerCase())
        || d.region.includes(q) || d.keywords.some((x) => x.includes(q))
        || d.ingredients.some((x) => x.includes(q)));
    }
  }
  return out;
}

/** 取 n 道不重复的随机菜；avoidId 会被尽量避开（除非库里没别的了）。 */
export function pickFew(lib, n, { avoidId, rng = Math.random, pool } = {}) {
  const source = pool ?? lib.dishes;
  const bag = source.filter((d) => d.id !== avoidId);
  const use = bag.length >= Math.min(n, source.length) ? bag : source;
  const copy = use.slice();
  const out = [];
  const count = Math.max(1, Math.min(n, copy.length));
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/** 取一道随机菜。 */
export function pickOne(lib, { avoidId, rng = Math.random, pool } = {}) {
  return pickFew(lib, 1, { avoidId, rng, pool })[0] ?? null;
}

/** 一道菜在菜单里的一行简介（给人挑菜用，不剧透 prose）。 */
export function briefLine(d) {
  const tags = d.keywords.length ? `｜${d.keywords.join('·')}` : '';
  const where = d.region ? `（${d.region}）` : '';
  const hook = d.serving || d.texture || '';
  return `${d.name}${where}｜${d.cuisine === d.category ? d.cuisine : `${d.cuisine}·${d.category}`}${tags}${hook ? `\n    ${hook}` : ''}`;
}

/** 档位词：中文读起来才像话，「high」「low」是给代码看的。 */
const around = (n, lo, hi, mid) => (n <= lo ? '低' : n >= hi ? '高' : mid);

/**
 * 口味画像：从「吃过什么」+「反应」算出来的一小段话。
 * 同一道菜最多按 3 次计入（免得连吃三天把画像带跑）。
 */
export function tasteProfile(lib, state) {
  const counts = state?.counts ?? {};
  let total = 0;
  const sum = Object.fromEntries(TASTE_FIELDS.map((k) => [k, 0]));
  const cuisineCount = new Map();

  for (const [id, n] of Object.entries(counts)) {
    const d = lib.byId.get(id);
    if (!d) continue;
    const w = Math.min(3, Math.max(1, Number(n) || 1));
    total += w;
    for (const k of TASTE_FIELDS) sum[k] += d.taste[k] * w;
    cuisineCount.set(d.cuisine, (cuisineCount.get(d.cuisine) ?? 0) + w);
  }

  const avg = total
    ? Object.fromEntries(TASTE_FIELDS.map((k) => [k, Math.round(sum[k] / total)]))
    : null;

  const dislikes = (state?.reactions ?? []).filter((r) => r.liked === false);
  const likes = (state?.reactions ?? []).filter((r) => r.liked === true);
  const topCuisine = [...cuisineCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  if (!avg) {
    return {
      empty: true,
      avg: null,
      total,
      topCuisine: null,
      lines: ['还没吃过什么，画像还是空的。'],
    };
  }

  const lines = [];
  lines.push(`辣的耐受：${avg.辣}／100（${around(avg.辣, 15, 45, '微辣到中辣')}）`);
  lines.push(`甜口：${avg.甜}／100（${around(avg.甜, 25, 55, '中甜')}）`);
  lines.push(`酸：${avg.酸}／100 · 苦：${avg.苦}／100`);
  lines.push(`咸：${avg.咸}／100 · 油：${avg.油}／100`);
  lines.push(`厚重程度：${
    avg.油 + avg.咸 + avg.辣 >= 190 ? '偏重口' : avg.油 + avg.咸 + avg.辣 <= 105 ? '偏清淡' : '中间'
  }`);

  const words = [];
  if (avg.辣 >= 45) words.push('能吃辣');
  if (avg.甜 >= 50) words.push('嗜甜');
  if (avg.酸 >= 42) words.push('爱酸');
  if (avg.苦 >= 26) words.push('吃得来苦');
  if (avg.油 <= 40 && avg.咸 <= 45) words.push('偏清淡');
  if (avg.油 >= 62) words.push('吃得住油');
  if (topCuisine) words.push(`最常入口的是${topCuisine}`);
  if (words.length) lines.push(`一句话：${words.join('、')}。`);

  return {
    empty: false,
    avg,
    total,
    topCuisine,
    likes: likes.map((r) => r.name || r.id).slice(-6),
    dislikes: dislikes.map((r) => r.name || r.id).slice(-6),
    lines,
  };
}
