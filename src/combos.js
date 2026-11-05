/**
 * 套餐（一桌菜）：把"几道菜"当一件事看。
 *
 * 两种桌，按为什么分成两类：
 *   · 固定桌 `dishes: [id…]`——就是那几道。面板上勾出来的桌用这种（勾了哪几道就是哪几道）。
 *   · 配方桌 `slots: [槽…]`——按槽位现配。内置预设用这种：
 *     写死 5 个 id 的话，库一改名预设就悄悄指向不存在的菜；配方桌库里加了新菜自动受益。
 *
 * 纯逻辑，不碰 fs / 定时器 / 宿主，便于单测（和 state.js / eat.js 同构）。
 *
 * 配菜的两条纪律（都是踩过才写下来的）：
 *   1. 结构由槽位保证，不是"取最相近的 N 道"。画像偏辣时的正确结果不是"5 道辣菜"，
 *      而是"辣的 2 道热菜 + 1 道解辣的凉菜 + 1 道汤"。
 *   2. 槽内不从"最相近的前 N 名"直接取，而是从前 3×N 名里按种子抽——
 *      否则每次配出来完全相同，而且几道菜会挤在同一个味道上。
 */
import { TASTE_FIELDS, filterDishes } from './dishes.js';
import { rngFrom } from './rand.js';

/** 一桌最多几道（防配置写歪了配出 50 道）。 */
export const MAX_TABLE = 12;
/** 槽内候选池的倍数：要在 3 倍候选里抽，抽出来才有变化。 */
const CANDIDATE_FACTOR = 3;

/**
 * 内置预设。**一份都别写死 dish id**——理由见文件头。
 * 类别名取自 dishes.js 的 CATEGORIES 白名单。
 *
 * 可行性是按 701 道的实际供给核过的：饮品只有 19 道、火锅 14 道（还散在 6 个菜系里，
 * 一个菜系最多 3 道）。所以没有任何预设敢要"2 道同菜系的火锅"，饮品槽也只敢要 1 道。
 */
export const PRESETS = [
  {
    id: 'four-dishes-soup',
    name: '四菜一汤',
    // 别写「两荤一素」：库里没有可靠的荤素标签（全库带「素」字的只有 2 道），
    // 按槽位配出来可能是四道全荤。说明只承诺结构，不承诺荤素搭配。
    desc: '两道热菜、一道凉菜、一道小吃，再加一道汤。最像"正正经经吃顿饭"的一桌。',
    slots: [
      { label: '一道凉菜', count: 1, category: '凉菜' },
      { label: '两道热菜', count: 2, category: '热菜' },
      { label: '一道小吃', count: 1, category: '小吃' },
      { label: '一道汤', count: 1, category: '汤羹' },
    ],
  },
  {
    id: 'banquet-eight',
    name: '一桌酒席',
    desc: '八道，从头到尾：先凉后热，压一道主食，收一道甜品。',
    slots: [
      { label: '两道凉菜', count: 2, category: '凉菜' },
      { label: '三道热菜', count: 3, category: '热菜' },
      { label: '一道汤', count: 1, category: '汤羹' },
      { label: '一道主食', count: 1, category: '主食' },
      { label: '一道甜品收尾', count: 1, category: '甜品' },
    ],
  },
  {
    id: 'solo',
    name: '一个人吃',
    desc: '两道就够：一碗主食，一碗汤。不用摆盘，趁热吃。',
    slots: [
      { label: '一碗主食', count: 1, category: '主食' },
      { label: '一碗汤', count: 1, category: '汤羹' },
    ],
  },
  {
    id: 'light-meal',
    name: '清爽一餐',
    desc: '四道都往清淡里挑：不重油、不重咸、不辣。',
    slots: [
      { label: '一道凉菜', count: 1, category: '凉菜', light: true },
      { label: '一道热菜', count: 1, category: '热菜', light: true },
      { label: '一道汤', count: 1, category: '汤羹', light: true },
      { label: '一道主食', count: 1, category: '主食', light: true },
    ],
  },
  {
    id: 'by-taste',
    name: '按她的口味配',
    desc: '照她吃过攒出来的口味画像挑，槽位还是齐的：有热有凉有汤。',
    slots: [
      { label: '两道热菜', count: 2, category: '热菜', byTaste: true },
      { label: '一道凉菜或小吃', count: 1, categories: ['凉菜', '小吃'], byTaste: true },
      { label: '一道汤或主食', count: 1, categories: ['汤羹', '主食'], byTaste: true },
    ],
  },
  {
    id: 'sichuan-table',
    name: '川菜一桌',
    desc: '四道全从川菜里出。想换别的菜系就现配一桌、把菜系说清楚。',
    slots: [
      { label: '两道热菜', count: 2, category: '热菜', cuisine: '川菜' },
      { label: '一道凉菜', count: 1, category: '凉菜', cuisine: '川菜' },
      { label: '一道汤或小吃', count: 1, categories: ['汤羹', '小吃'], cuisine: '川菜' },
    ],
  },
  {
    id: 'cantonese-table',
    name: '粤菜一桌',
    // 同上：粤菜里「点心」不能保证配到，所以写"汤或点心"，不写死"一荤一素一点心"。
    desc: '四道全从粤菜里出：热菜、凉菜，再加一道汤或点心。',
    slots: [
      { label: '两道热菜', count: 2, category: '热菜', cuisine: '粤菜' },
      { label: '一道凉菜', count: 1, category: '凉菜', cuisine: '粤菜' },
      { label: '一道汤或点心', count: 1, categories: ['汤羹', '面点'], cuisine: '粤菜' },
    ],
  },
  {
    id: 'late-night',
    name: '夜宵',
    desc: '天冷了，或者就是想吃点零的：烤的、炸的，再来一杯。',
    slots: [
      { label: '一份烧烤', count: 1, category: '烧烤' },
      { label: '一份小吃', count: 1, category: '小吃' },
      { label: '一杯喝的', count: 1, category: '饮品' },
    ],
  },
];

/** 预设是代码不是数据，照 id 或名字找。 */
export function findPreset(ref) {
  const q = String(ref ?? '').trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  return PRESETS.find((c) => c.id === q)
    ?? PRESETS.find((c) => c.name === q)
    ?? PRESETS.find((c) => c.name.includes(q) || c.id.includes(lower))
    ?? null;
}

/**
 * 在一组套餐里按 id / 名字找（预设 + 自定义一起用，因为 id 是一个命名空间）。
 * 名字完全一致优先，其次 id，最后才模糊。
 */
export function findCombo(combos, ref) {
  const q = String(ref ?? '').trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  return combos.find((c) => c.name === q)
    ?? combos.find((c) => c.id === q)
    ?? combos.find((c) => c.name.includes(q) || c.id.includes(lower))
    ?? null;
}

/** 自定义套餐的 id：名字转 kebab，撞了就加序号。 */
export function comboIdFrom(name, taken = new Set()) {
  const base = String(name ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'combo';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// 打分
// ---------------------------------------------------------------------------

/** 九维 L1 距离：越小越接近这个画像。没有画像时返回 0（等于无偏好）。 */
export function scoreByTaste(dish, avg) {
  if (!avg) return 0;
  let d = 0;
  for (const k of TASTE_FIELDS) d += Math.abs((dish.taste?.[k] ?? 0) - (avg[k] ?? 0));
  return d;
}

/** 清淡程度：油 + 咸 + 辣 之和，越小越清淡。 */
export function lightScore(dish) {
  const t = dish.taste ?? {};
  return (t.油 ?? 0) + (t.咸 ?? 0) + (t.辣 ?? 0);
}

/**
 * 一桌的九维平均（四舍五入）。空桌返回 null。
 *
 * **饮品不算进这一桌的口味签名。** 一杯奶茶的油咸辣天然接近 0，
 * 算进去会把"烧烤 + 蚕豆泥 + 奶茶"平均成「清爽」——那就成了假话。
 * 一桌全是饮品时才退回把饮品也算进来（否则没有东西可算）。
 */
export function tableTaste(dishes) {
  if (!dishes?.length) return null;
  const food = dishes.filter((d) => d.category !== '饮品');
  const use = food.length ? food : dishes;
  const sum = Object.fromEntries(TASTE_FIELDS.map((k) => [k, 0]));
  for (const d of use) for (const k of TASTE_FIELDS) sum[k] += d.taste?.[k] ?? 0;
  return Object.fromEntries(TASTE_FIELDS.map((k) => [k, Math.round(sum[k] / use.length)]));
}

/**
 * 一桌的口味一句话。分档沿用 tasteProfile 已经在用的那套阈值，
 * 不另立一套——同一份库里"偏辣"在画像页和套餐页说的应该是同一件事。
 */
export function tableLine(taste) {
  if (!taste) return '空的一桌';
  const heavy = (taste.油 ?? 0) + (taste.咸 ?? 0) + (taste.辣 ?? 0);
  const words = [];
  if ((taste.辣 ?? 0) >= 45) words.push('偏辣');
  if ((taste.甜 ?? 0) >= 50) words.push('偏甜');
  if ((taste.酸 ?? 0) >= 42) words.push('偏酸');
  if (heavy >= 190) words.push('重口');
  else if (heavy <= 105) words.push('清爽');
  if (!words.length) words.push('中间');
  return words.join(' · ');
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/** 一个槽允许的类别：`category` 和 `categories` 都认。 */
function slotCategories(slot) {
  if (Array.isArray(slot.categories) && slot.categories.length) return slot.categories;
  return slot.category ? [slot.category] : null;
}

/** 这一槽的候选池（已经去掉不能用的）。 */
function slotPool(lib, slot, { exclude, demote }) {
  const cats = slotCategories(slot);
  let pool = cats
    ? lib.dishes.filter((d) => cats.includes(d.category))
    : filterDishes(lib, {});
  if (slot.cuisine) pool = pool.filter((d) => d.cuisine === slot.cuisine);
  if (slot.keyword) pool = pool.filter((d) => d.keywords.some((k) => k.includes(slot.keyword) || slot.keyword.includes(k)));
  if (exclude?.size) pool = pool.filter((d) => !exclude.has(d.id));
  // 上一顿吃过的那道排到最后，而不是直接删掉——库里没别的了还得给。
  if (demote) {
    const rest = pool.filter((d) => d.id !== demote);
    pool = rest.length ? rest : pool;
  }
  return pool;
}

/** 池子怎么排：按口味画像最近，或按最清淡，或不动（随机）。 */
function rankSlot(slot, pool, avg) {
  if (slot.byTaste && avg) return pool.slice().sort((a, b) => scoreByTaste(a, avg) - scoreByTaste(b, avg));
  if (slot.light) return pool.slice().sort((a, b) => lightScore(a) - lightScore(b));
  return pool.slice();
}

/**
 * 把一张桌解析成具体的菜。
 *
 * @param lib           菜品库（loadDishes 的返回）
 * @param combo         一张桌（预设或自定义）
 * @param options.avg       口味画像的九维均值，给 byTaste 用；null = 不按口味
 * @param options.seed      种子；同一个种子同一张桌。空串 = 用 combo.id
 * @param options.exclude   绝对不能进桌的 id（比如她标记过 dislike 的）
 * @param options.demote    降到最后的一个 id（比如上一顿刚吃过的那道）
 * @returns {{ dishes, missing, taste, line }}
 *   missing：没能配出来的槽位说明（不静默——"少了一道汤"要说得出来）
 */
export function resolveCombo(lib, combo, { avg = null, seed = '', exclude = [], demote = null } = {}) {
  const bad = combo?.dishes?.filter((id) => !lib.byId.has(String(id))) ?? [];
  const ex = new Set(exclude.map(String));
  const dishes = [];
  const missing = [];
  const taken = new Set();

  if (Array.isArray(combo?.dishes) && combo.dishes.length) {
    // 固定桌：查不到的丢掉并如实报出来，不抛——库一直在长，一条坏引用不该让整桌起不来。
    for (const id of combo.dishes) {
      const d = lib.byId.get(String(id));
      if (!d || ex.has(d.id) || taken.has(d.id)) continue;
      taken.add(d.id);
      dishes.push(d);
    }
    for (const id of bad) missing.push(`没有这道菜：${id}`);
  } else {
    const rng = rngFrom(seed || combo?.id || 'combo');
    for (const slot of combo?.slots ?? []) {
      const want = Math.max(1, Math.round(Number(slot.count) || 1));
      let pool = slotPool(lib, slot, { exclude: ex, demote }).filter((d) => !taken.has(d.id));
      if (!pool.length) {
        missing.push(`${slot.label ?? '一道菜'}没配出来（这个条件下库里没有可用的菜）`);
        continue;
      }
      const ranked = rankSlot(slot, pool, avg);
      // 从前 3×want 名里抽：直接取前 want 名的话每次都一样，而且几道菜会挤在同一个味道上。
      const candidates = ranked.slice(0, Math.max(want, want * CANDIDATE_FACTOR));
      const available = candidates.length;
      let got = 0;
      for (let i = 0; i < want && candidates.length; i += 1) {
        const idx = Math.floor(rng() * candidates.length) % candidates.length;
        const picked = candidates.splice(idx, 1)[0];
        taken.add(picked.id);
        dishes.push(picked);
        got += 1;
      }
      if (got < want) missing.push(`${slot.label ?? '一道菜'}只配到 ${available} 道（要 ${want} 道）`);
    }
  }

  const taste = tableTaste(dishes);
  return { dishes, missing, taste, line: tableLine(taste) };
}

/** 不带套餐时"来一桌"：几道、要不要按口味、限定菜系。 */
export function adhocCombo({ size = 4, cuisine = '', byTaste = true } = {}) {
  // 注意别写成 `Number(size) || 4`：那样 size=0 会被当成"没给"而退回 4，
  // 0 是个写歪的值，该被夹到 1，不是换成默认值。
  const want = Number(size);
  const n = Number.isFinite(want) ? Math.max(1, Math.min(MAX_TABLE, Math.round(want))) : 4;
  // 槽位顺序照着真上菜的顺序排：先凉后热，主食靠后，甜品垫底。
  const shape = [
    { label: '一道凉菜', count: 1, category: '凉菜' },
    { label: '两道热菜', count: 2, category: '热菜' },
    { label: '一道主食', count: 1, category: '主食' },
  ];
  const slots = [];
  let left = n;
  for (const s of shape) {
    if (left <= 0) break;
    const take = Math.min(s.count, left);
    slots.push({ ...s, count: take, byTaste });
    left -= take;
  }
  // 超出 4 道的部分，用汤/小吃/甜品续——别让"来 6 道"配出 6 道热菜。
  const extra = [
    { label: '一道汤', count: 1, category: '汤羹' },
    { label: '一道小吃', count: 1, category: '小吃' },
    { label: '一道甜品', count: 1, category: '甜品' },
    { label: '一道面点', count: 1, category: '面点' },
    { label: '一份烧烤', count: 1, category: '烧烤' },
    { label: '一道热菜', count: 1, category: '热菜' },
    { label: '一道凉菜', count: 1, category: '凉菜' },
    { label: '一杯喝的', count: 1, category: '饮品' },
  ];
  for (const s of extra) {
    if (left <= 0) break;
    slots.push({ ...s, byTaste });
    left -= 1;
  }
  if (cuisine) for (const s of slots) s.cuisine = String(cuisine);
  return {
    id: `adhoc-${n}${cuisine ? `-${cuisine}` : ''}`,
    name: cuisine ? `${cuisine}·现配一桌` : '现配一桌',
    desc: '没指定套餐，按口味画像和上菜顺序现配的一桌。',
    kind: 'adhoc',
    slots,
  };
}

/** 一张桌一共几道（配方桌看槽位，固定桌看列表）。 */
export function comboSize(combo) {
  if (Array.isArray(combo?.dishes) && combo.dishes.length) return combo.dishes.length;
  return (combo?.slots ?? []).reduce((a, s) => a + Math.max(1, Math.round(Number(s.count) || 1)), 0);
}

// ---------------------------------------------------------------------------
// 自定义套餐的存取形状（落盘的部分在 world.js / combos.json）
// ---------------------------------------------------------------------------

/** 磁盘上的一条自定义套餐补齐成当前形状；读不出名字的直接丢掉。 */
export function normalizeCombo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (!name) return null;
  const ids = Array.isArray(raw.dishes)
    ? [...new Set(raw.dishes.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]
    : [];
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 60) : '';
  return {
    id,
    name,
    desc: typeof raw.desc === 'string' ? raw.desc.trim().slice(0, 120) : '',
    kind: 'custom',
    dishes: ids.slice(0, MAX_TABLE),
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

/** 校验一条自定义套餐能不能存。返回一句人话的错误，或空串。 */
export function comboProblem(combo, lib) {
  if (!combo?.name?.trim()) return '这一桌得起个名字。';
  const ids = combo.dishes ?? [];
  if (!ids.length) return '这一桌一道菜都没有。';
  if (ids.length > MAX_TABLE) return `一桌最多 ${MAX_TABLE} 道，现在有 ${ids.length} 道。`;
  if (new Set(ids).size !== ids.length) return '同一道菜在一桌里出现了两次。';
  const unknown = ids.filter((id) => !lib.byId.has(id));
  if (unknown.length) return `这些菜库里没有：${unknown.join('、')}。`;
  return '';
}
