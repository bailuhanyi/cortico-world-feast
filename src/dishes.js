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
    logger?.warn?.(`鱼的每一天：菜品目录读不到（${err?.message ?? err}）`);
  }

  for (const file of files) {
    let arr;
    try {
      arr = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8'));
    } catch (err) {
      bad += 1;
      logger?.warn?.(`鱼的每一天：${file} 解析失败，跳过 —— ${err?.message ?? err}`);
      continue;
    }
    if (!Array.isArray(arr)) {
      bad += 1;
      logger?.warn?.(`鱼的每一天：${file} 顶层不是数组，跳过`);
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

  // 面板是「先选形态，再在里面挑菜系」，所以每个类别要知道自己下面有哪些菜系。
  // 不这么给的话，选了「汤羹」还会看到「墨西哥菜」这种一按就没结果的选项。
  const categoryCuisines = {};
  for (const c of categories) {
    categoryCuisines[c] = [...new Set(dishes.filter((d) => d.category === c).map((d) => d.cuisine))].sort();
  }

  cache = { dishes, byId, cuisines, categories, categoryCuisines, bad };
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

/**
 * 只认精确匹配：id、名字、别名（别名不分大小写）。找不到返回 null。
 *
 * 和 `findDish` 的区别是**不做模糊匹配**。主人随手写一句"我在吃…"时用这个：
 * 模糊匹配会把「在啃面包」对成「蒜香面包」——那就成了替他编（不变式 6）。
 * 她的工具仍然走 `findDish`（她说的比库里短算数，是另一回事）。
 */
export function findDishExact(lib, ref) {
  if (!ref) return null;
  const q = String(ref).trim();
  if (!q) return null;
  const byId = lib.byId.get(q);
  if (byId) return byId;
  const name = lib.dishes.find((d) => d.name === q);
  if (name) return name;
  const lower = q.toLowerCase();
  return lib.dishes.find((d) => d.alias && d.alias.toLowerCase() === lower) ?? null;
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

const MENU_RECENT_MS = 7 * 24 * 3600_000;

/** 只读当前可用的过去记录；持久 counts 另作「吃过」依据，不猜被剪掉的日期。 */
function menuEatenHistory(lib, state, nowMs) {
  const history = new Map();
  for (const e of Array.isArray(state?.eaten) ? state.eaten : []) {
    if (!e || !lib.byId.has(e.id) || !Number.isFinite(e.at) || e.at > nowMs) continue;
    const entry = history.get(e.id) ?? { lastAt: -Infinity, recentCount: 0 };
    entry.lastAt = Math.max(entry.lastAt, e.at);
    if (e.at >= nowMs - MENU_RECENT_MS) entry.recentCount += 1;
    history.set(e.id, entry);
  }
  return history;
}

function menuDishTried(state, id, history) {
  const count = Number(state?.counts?.[id]);
  return (Number.isFinite(count) && count > 0) || history.has(id);
}

/**
 * 菜单快捷筛选，与原菜系/类别/标签/自由词条件求交，不修改库或状态。
 * quick 默认 all；liked 遵循口味画像的最新有效反馈，吃过不代表喜欢；
 * untried 查持久 counts（兼顾仍在的过去记录）；recent 为 [now-7天, now]，最近吃的在前。
 */
export function filterMenuDishes(lib, state, filter = {}, nowMs = Date.now()) {
  const pool = filterDishes(lib, filter);
  if (filter.quick === 'liked') {
    const liked = new Set(tasteProfile(lib, state).likedIds);
    return pool.filter((d) => liked.has(d.id));
  }
  if (filter.quick === 'untried' || filter.quick === 'recent') {
    const history = menuEatenHistory(lib, state, nowMs);
    if (filter.quick === 'untried') return pool.filter((d) => !menuDishTried(state, d.id, history));
    return pool.filter((d) => history.get(d.id)?.recentCount > 0)
      .sort((a, b) => history.get(b.id).lastAt - history.get(a.id).lastAt);
  }
  return pool;
}

/**
 * 在实际菜单筛选池内尝鲜，排除最新明确讨厌的菜，最多返回 3 道不同的原菜品对象。
 * 分层随机：没吃过 > 最近 7 天未吃 > 近期一次 > 近期反复；不足才向后补，不突破筛选。
 * limit 取非负整数并封顶 3；nowMs/rng 可注入，使调用与测试可复现。
 */
export function recommendMenuDishes(lib, state, {
  limit = 3, nowMs = Date.now(), rng = Math.random, ...filter
} = {}) {
  const count = Math.max(0, Math.min(3, Math.floor(Number(limit) || 0)));
  if (!count) return [];
  const pool = filterMenuDishes(lib, state, filter, nowMs);
  const disliked = new Set(tasteProfile(lib, state).dislikedIds);
  const history = menuEatenHistory(lib, state, nowMs);
  const tiers = [[], [], [], []];
  const seen = new Set();
  for (const d of pool) {
    if (seen.has(d.id) || disliked.has(d.id)) continue;
    seen.add(d.id);
    const recentCount = history.get(d.id)?.recentCount ?? 0;
    const tier = recentCount > 1 ? 3 : recentCount === 1 ? 2
      : menuDishTried(state, d.id, history) ? 1 : 0;
    tiers[tier].push(d);
  }
  const out = [];
  for (const tier of tiers) {
    while (tier.length && out.length < count) {
      const index = Math.floor(rng() * tier.length);
      out.push(tier.splice(index, 1)[0]);
    }
    if (out.length === count) break;
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

/** 至少喜欢两道不同的菜，才开始归纳口味偏好。 */
const PREFERENCE_MIN_LIKES = 2;

/**
 * 口味画像：avg 是饮食经历，preferenceAvg 才是明确喜欢的口味。
 * 经历中同一道菜最多按 3 次计入；偏好每菜一票，不因重复反馈增加权重。
 * reactions 按 state 追加顺序取同菜最后一条有效意见，null（一般）可撤销旧意见。
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

  const latest = new Map();
  for (const r of Array.isArray(state?.reactions) ? state.reactions : []) {
    if (!r || !lib.byId.has(r.id) || ![true, false, null].includes(r.liked)) continue;
    // 重新插入使摘要也按最新反馈顺序排列；坏记录不会盖掉已有的有效意见。
    latest.delete(r.id);
    latest.set(r.id, r);
  }
  const likes = [...latest.values()].filter((r) => r.liked === true);
  const dislikes = [...latest.values()].filter((r) => r.liked === false);
  const preferenceReady = likes.length >= PREFERENCE_MIN_LIKES;
  const preferenceAvg = preferenceReady
    ? Object.fromEntries(TASTE_FIELDS.map((k) => [k, Math.round(
      likes.reduce((s, r) => s + lib.byId.get(r.id).taste[k], 0) / likes.length,
    )]))
    : null;
  const topCuisine = [...cuisineCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const lines = [];
  if (avg) {
    lines.push(`吃过的口味均值（饮食经历）：辣 ${avg.辣}／100 · 麻 ${avg.麻}／100 · 甜 ${avg.甜}／100`);
    lines.push(`鲜：${avg.鲜}／100 · 香：${avg.香}／100 · 酸：${avg.酸}／100 · 苦：${avg.苦}／100`);
    lines.push(`咸：${avg.咸}／100 · 油：${avg.油}／100`);
    if (topCuisine) lines.push(`最常入口的是${topCuisine}，只表示吃过的经历。`);
  } else {
    lines.push('还没吃过什么，饮食经历画像还是空的。');
  }

  if (!preferenceAvg) {
    lines.push(`喜欢偏好：反馈不足（目前明确喜欢 ${likes.length} 道，至少需要 ${PREFERENCE_MIN_LIKES} 道不同的菜）；吃过不代表喜欢。`);
  } else {
    lines.push(`喜欢的口味均值（${likes.length} 道明确喜欢的菜）：${TASTE_FIELDS.map((k) => `${k} ${preferenceAvg[k]}／100`).join(' · ')}`);
    const words = [];
    if (preferenceAvg.辣 >= 45) words.push('偏爱辣口');
    if (preferenceAvg.甜 >= 50) words.push('偏爱甜口');
    if (preferenceAvg.酸 >= 42) words.push('偏爱酸口');
    if (preferenceAvg.苦 >= 26) words.push('喜欢的菜里有苦味');
    if (preferenceAvg.油 <= 40 && preferenceAvg.咸 <= 45) words.push('偏爱清淡');
    if (preferenceAvg.油 >= 62) words.push('偏爱油润');
    lines.push(`喜欢偏好：${words.length ? words.join('、') : '暂未呈现明显的口味倾向'}（仅据明确喜欢的菜归纳）。`);
  }

  return {
    empty: !avg,
    avg,
    total,
    topCuisine,
    preferenceAvg,
    preferenceReady,
    preferenceCount: likes.length,
    preferenceMinLikes: PREFERENCE_MIN_LIKES,
    feedbackCount: latest.size,
    likedIds: likes.map((r) => r.id),
    dislikedIds: dislikes.map((r) => r.id),
    likes: likes.map((r) => r.name || lib.byId.get(r.id).name).slice(-6),
    dislikes: dislikes.map((r) => r.name || lib.byId.get(r.id).name).slice(-6),
    lines,
  };
}
