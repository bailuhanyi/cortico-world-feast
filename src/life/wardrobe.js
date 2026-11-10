/**
 * 「她的一天」×「生图工作室」联动（0.7.1）。
 *
 * World 契约不允许一个 World 调另一个扩展的工具，也不允许一个 World 依赖另一个扩展。
 * 所以联动只做两件事，都**不碰对方的代码**：
 *
 *   1. **共享素材库的文件约定**：双方都读 `<数据目录>/imggen-library/`。
 *      这里扫 `characters / outfits / scenes / props` 下每个条目的 `entry.json`，
 *      把名字、别名、标签、情境穿搭（`outfitByContext`）、默认服饰（`defaultOutfit`）
 *      读出来，列给 Coo 写日程时参考，并按优先级自动补 `outfit`。
 *
 *   2. **提示词里各写一句指向对方**：envBlock 里加一句「想发图时穿着地点按日程来」，
 *      planEventText 里列出衣柜；让对方自己在 ENV_PROMPT 加反向的一句。
 *
 * **降级是第一公民**：库读不到、目录不存在、entry.json 坏了——一律静默返回空库，
 * 绝不抛错、绝不影响她的一天、绝不影响生图工作室。整个模块对外的每个函数都 try/catch。
 *
 * 字段来源（2026-11-10 读的真实 entry.json）：
 *   { name, aliases:[], tags:[], desc, defaultOutfit, outfitByContext:{情境:服饰名}, cover }
 * 同一套字段在四类条目里都有（scenes / props 的 outfitByContext / defaultOutfit 是空的，
 * 但字段名一致，所以一套解析逻辑通吃）。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { isAsleepActivity } from './free.js';

const KINDS = ['characters', 'outfits', 'scenes', 'props'];
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v, max = 40) => (Array.isArray(v) ? v : []).map((x) => text(x, max)).filter(Boolean);

/**
 * 空库：读不到时返回这个。`empty: true` 让调用方一句 `if (lib.empty)` 就能判断。
 * 字段齐全（都是空数组），调用方不用判 undefined。
 */
export function emptyWardrobe() {
  return { characters: [], outfits: [], scenes: [], props: [], empty: true, at: 0 };
}

/**
 * 库目录：cfg.lifeWardrobeDir 留空 = 用默认路径 <dataDir>/imggen-library。
 *
 * 这是**同步**版本，只处理手动覆盖和默认路径。`loadWardrobe` 用异步的
 * `resolveWardrobeDir`，它还会去读 imggen 的 libraryRoot（见下）。
 */
export function wardrobeDir(dataDir, cfgDir) {
  const d = typeof cfgDir === 'string' ? cfgDir.trim() : '';
  return d || join(dataDir, 'imggen-library');
}

/**
 * 读 Coo config 里的 `worlds.imggen.libraryRoot`。
 *
 * 用户会在 imggen 那边改库目录（真实案例 `H:\大肥鱼桌宠\生图文件`），按默认路径读
 * 会摸到空库、静默降级后联动永远不发生。这里自动跟上 imggen 的配置。
 *
 * 读 config 文件**不算 World 间依赖**：只是读一个文件，不调 imggen 的工具、不读它的
 * 状态。config 路径按 dataDir 的父目录找（`<dataDir>/../config.json`）。
 * 读不到、没有 worlds.imggen、或 libraryRoot 为空——一律返回空串，交给默认兜底。
 *
 * config.json 是 Coo **整份重写**的（改任何配置项都会重写一次），存在「读到写了一半
 * 的文件」的窗口。解析失败时**等 200ms 重试一次**，再失败才降级——否则用户改配置
 * 的那一瞬间正好触发读库，会误判成「没配置」掉回默认路径。
 */
export async function readImggenRoot(dataDir) {
  const tryOnce = async () => {
    try {
      const cfgPath = join(dataDir, '..', 'config.json');
      const raw = JSON.parse(await readFile(cfgPath, 'utf8'));
      const root = raw?.worlds?.imggen?.libraryRoot;
      return typeof root === 'string' && root.trim() ? root.trim() : '';
    } catch {
      return null; // 区分「读不到/解析失败」(null) 和「读到了但没配」('')
    }
  };
  const first = await tryOnce();
  if (first !== null) return first;
  // 写一半的文件窗口：等 200ms 再读一次。
  await new Promise((r) => setTimeout(r, 200));
  const second = await tryOnce();
  return second ?? '';
}

/**
 * 异步解析库目录，优先级：
 *   1. cfg.lifeWardrobeDir（手动覆盖，最高）
 *   2. Coo config 里 worlds.imggen.libraryRoot（自动跟 imggen）
 *   3. <dataDir>/imggen-library（默认兜底）
 */
export async function resolveWardrobeDir(dataDir, cfgDir) {
  const manual = typeof cfgDir === 'string' ? cfgDir.trim() : '';
  if (manual) return manual;
  const imggenRoot = await readImggenRoot(dataDir);
  if (imggenRoot) return imggenRoot;
  return join(dataDir, 'imggen-library');
}

/**
 * 读一个条目的 entry.json。坏文件跳过，不抛——一个手改坏的 json 不该让整个库读不出来。
 * 返回 null 表示这个目录没有合法条目。
 */
async function readEntry(dirPath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(join(dirPath, 'entry.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name, 40);
  if (!name) return null;
  const ctx = raw.outfitByContext && typeof raw.outfitByContext === 'object' ? raw.outfitByContext : {};
  const outfitByContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    const kk = text(k, 20);
    const vv = text(v, 40);
    if (kk && vv) outfitByContext[kk] = vv;
  }
  return {
    name,
    aliases: list(raw.aliases, 40),
    tags: list(raw.tags, 30),
    desc: text(raw.desc, 200),
    defaultOutfit: text(raw.defaultOutfit, 60),
    outfitByContext,
  };
}

/** 扫某一类（characters/outfits/...）下所有子目录。 */
async function readKind(rootPath, kind) {
  const kindDir = join(rootPath, kind);
  let names = [];
  try {
    names = await readdir(kindDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of names) {
    if (ent.isDirectory?.() !== true && ent.isDirectory !== true) continue;
    if (ent.name.startsWith('.')) continue;
    const entry = await readEntry(join(kindDir, ent.name));
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * 缓存：以「目录路径」为 key。缓存命中时先 stat 目录，mtime 没变就直接用，
 * 变了才重扫——每 30 秒一拍去读整个库太浪费。
 *
 * 缓存是模块级的（进程内单例）。测试里想强制重读，传 `force: true`。
 */
const CACHE = new Map();

/**
 * 加载素材库。永远不抛：出错就返回空库。
 *
 * @param {string} dataDir 数据目录
 * @param {object} opts { cfgDir?: 覆盖库目录, force?: 强制重扫 }
 * @returns {Promise<object>} 库；读不到就是空库（empty:true）
 */
export async function loadWardrobe(dataDir, opts = {}) {
  try {
    // 优先级：手动覆盖 > imggen 的 libraryRoot > 默认路径。
    // resolveWardrobeDir 会去读 Coo config，读不到就降级到默认。
    const dir = await resolveWardrobeDir(dataDir, opts.cfgDir);
    let mtime = 0;
    try {
      mtime = (await stat(dir)).mtimeMs;
    } catch {
      // 目录不存在：静默降级。但缓存里可能有旧的（目录被删了），清掉。
      CACHE.delete(dir);
      return emptyWardrobe();
    }
    const cached = CACHE.get(dir);
    if (cached && !opts.force && cached.at === mtime) return cached.lib;

    const lib = { empty: false, at: mtime };
    let total = 0;
    for (const kind of KINDS) {
      const items = await readKind(dir, kind);
      lib[kind] = items;
      total += items.length;
    }
    if (total === 0) {
      // 目录在但四类全空：也当空库，调用方就不用列「（空）」了。
      return emptyWardrobe();
    }
    lib.empty = false;
    CACHE.set(dir, { lib, at: mtime });
    return lib;
  } catch {
    return emptyWardrobe();
  }
}

/** 同步清缓存（测试用）。 */
export function clearWardrobeCache() {
  CACHE.clear();
}

// ---------------------------------------------------------------------------
// 自动补 outfit
// ---------------------------------------------------------------------------

/**
 * 情境默认表：situation 关键词 → 推荐的 outfit 名。
 *
 * entry.json 里只有显式配的 `outfitByContext`（`{"睡前":"睡衣"}`），没有「situation 自带
 * 默认服饰」这份数据——那是 imggen 代码里的逻辑，我们读文件拿不到。为了让没配
 * outfitByContext 的用户也能「开箱即用」（situation=睡前 时自动有睡衣），这里内置一份
 * 常识默认表，库里 find 到对应 outfit 才用、find 不到就跳过（不编不存在的衣服）。
 *
 * situation 做包含匹配：「准备睡觉」含「睡」→ 睡衣；但字段通常是「睡前」这种短词，
 * 直接查表也行。表里的 outfit 名是库里常见的正名（睡衣、通勤衬衫…），不同库可能没有，
 * find 不到就继续往下走优先级。
 *
 * 这张表可被 cfg 覆盖（暂未开配置项，预留）。
 */
const SITUATION_DEFAULTS = [
  { hint: '睡', outfit: '睡衣' },
  { hint: '刚醒', outfit: '睡衣' },
  { hint: '通勤', outfit: '通勤衬衫' },
  { hint: '上班', outfit: '通勤衬衫' },
  { hint: '工作', outfit: '通勤衬衫' },
  { hint: '休闲', outfit: '居家针织服' },
  { hint: '居家', outfit: '居家针织服' },
  { hint: '在家', outfit: '居家针织服' },
  { hint: '出门', outfit: '外出外套' },
  { hint: '外出', outfit: '外出外套' },
  { hint: '逛街', outfit: '外出外套' },
  { hint: '洗澡', outfit: '浴袍' },
  { hint: '沐浴', outfit: '浴袍' },
  { hint: '游泳', outfit: '泳装' },
  { hint: '海边', outfit: '泳装' },
];

/** 按 situation 关键词查情境默认表，返回推荐的 outfit 名（库里有的才算数，由调用方 find）。 */
function situationDefaultOutfit(situation) {
  const sit = text(situation, 20);
  if (!sit) return '';
  for (const rule of SITUATION_DEFAULTS) {
    if (sit.includes(rule.hint)) return rule.outfit;
  }
  return '';
}

/**
 * 在库里找一个名字（精确名 / 别名 / 唯一包含）。找不到返回 null。
 * 不依赖生图工作室那边的 findEntry：我们自己照着实现一份，保证库改了字段名我们这边不崩。
 */
export function findWardrobeItem(lib, kind, name) {
  const items = lib?.[kind];
  if (!Array.isArray(items) || !name) return null;
  const n = String(name).trim();
  if (!n) return null;
  let hit = items.find((it) => it.name === n);
  if (hit) return hit;
  hit = items.find((it) => it.aliases?.includes(n));
  if (hit) return hit;
  // 唯一包含：多个都包含就不取（歧义）。
  const contains = items.filter((it) => it.name.includes(n) || it.aliases?.some((a) => a.includes(n)));
  return contains.length === 1 ? contains[0] : null;
}

/**
 * 按优先级补一段日程的 outfit。
 *
 * 优先级（对方补充确认后定稿）：
 *   1. 模型自己填的（item.outfit 非空）——直接用，只在库里能对上时归一成正名；对不上保留原词
 *   2. 情境穿搭 outfitByContext[处境] ——她显式配的「睡前→睡衣」习惯，最该用
 *   3. 情境默认 ——没配习惯时，按 situation 关键词查常识表（睡前→睡衣），库里 find 到才用
 *   4. 延续上一段（prevOutfit）——没标情境、或情境习惯和默认都没命中时，接着上一段穿
 *      （起床、连续在家；睡觉那段不延续）
 *   5. 场景默认 —— 库里某个场景的 defaultOutfit
 *   6. 她的 defaultOutfit —— 人物条目里的默认服饰（最后兜底）
 *
 * 「情境默认」这级是库能开箱即用的关键：没配 outfitByContext 的用户，靠 situation
 * 也能穿对衣服（睡前自动有睡衣）。它读的是 feast 内置的常识表，不依赖 imggen 代码。
 *
 * 库为空时返回原 outfit（不补），保证「读不到库」和「库是空的」都不改日程内容。
 *
 * @returns {{ outfit?: string, source?: string }} 补全结果；outfit 为空表示没补到
 */
export function autoOutfit(item, lib, prevOutfit = '') {
  if (!item || typeof item !== 'object') return { outfit: '', source: '' };
  if (lib?.empty !== false) return { outfit: text(item.outfit, 40), source: item.outfit ? 'model' : '' };

  // 1. 模型填的：能对上库就归一成正名（让 imggen_draw 解析时更稳），对不上也保留原值。
  if (item.outfit) {
    const match = findWardrobeItem(lib, 'outfits', item.outfit);
    return { outfit: match ? match.name : text(item.outfit, 40), source: 'model' };
  }

  // 睡觉的判据和「她自己的时间」共用一处：/睡/ 认不出「回笼觉」「打盹」。
  const sleeping = isAsleepActivity(item);
  const char = lib.characters[0];
  const sit = text(item.situation, 20);

  // 2. 情境穿搭：她标了 situation 且习惯里有这一条——这是她自己写的强信号，最该用。
  if (char?.outfitByContext && sit) {
    const v = char.outfitByContext[sit];
    if (v) {
      const match = findWardrobeItem(lib, 'outfits', v);
      return { outfit: match ? match.name : v, source: 'context' };
    }
  }

  // 3. 情境默认：没配习惯时，按 situation 关键词查常识表。库里 find 到才用，find 不到跳过。
  if (sit) {
    const def = situationDefaultOutfit(sit);
    if (def) {
      const match = findWardrobeItem(lib, 'outfits', def);
      if (match) return { outfit: match.name, source: 'situation-default' };
    }
  }

  // 睡觉但没标情境、也没命中情境习惯/默认：不硬猜（不该给人物默认服饰——睡觉穿女仆裙不对）。
  if (sleeping) return { outfit: '', source: '' };

  // 4. 延续上一段：没标情境、或情境习惯和默认都没命中时，接着上一段穿（起床、连续在家）。
  if (prevOutfit) {
    const match = findWardrobeItem(lib, 'outfits', prevOutfit);
    return { outfit: match ? match.name : prevOutfit, source: 'carry' };
  }

  // 5. 场景默认：库里某个场景的 defaultOutfit（现在场景条目里这个字段都是空的，补不出）。
  if (item.scene) {
    const sc = findWardrobeItem(lib, 'scenes', item.scene);
    if (sc?.defaultOutfit) {
      const match = findWardrobeItem(lib, 'outfits', sc.defaultOutfit);
      return { outfit: match ? match.name : sc.defaultOutfit, source: 'scene' };
    }
  }

  // 6. 人物的 defaultOutfit（最后兜底）。
  if (char?.defaultOutfit) {
    const match = findWardrobeItem(lib, 'outfits', char.defaultOutfit);
    return { outfit: match ? match.name : char.defaultOutfit, source: 'default' };
  }

  return { outfit: '', source: '' };
}

/**
 * 给一整天的 items 补 outfit。按时间顺序，前一段的 outfit 传给下一段（延续）。
 *
 * 只补空槽，不覆盖模型填好的。返回**新数组**，不改原 items。
 * 也补 scene 的正名归一（能对上库就用正名），让 imggen_draw 的别名解析更稳。
 */
export function enrichItems(items, lib) {
  if (!Array.isArray(items) || !items.length) return items;
  if (lib?.empty !== false) return items;
  let prevOutfit = '';
  return items.map((it) => {
    const next = { ...it };
    if (it.scene) {
      const sc = findWardrobeItem(lib, 'scenes', it.scene);
      if (sc) next.scene = sc.name;
    }
    if (it.props?.length) {
      next.props = it.props.map((p) => {
        const m = findWardrobeItem(lib, 'props', p);
        return m ? m.name : p;
      });
    }
    const { outfit, source } = autoOutfit(it, lib, prevOutfit);
    if (outfit && !it.outfit) {
      next.outfit = outfit;
      next.outfitSource = source;
    } else if (it.outfit) {
      // 归一成正名（autoOutfit 的第 1 级会做，这里也保证 enrich 后是正名）。
      const m = findWardrobeItem(lib, 'outfits', it.outfit);
      if (m) next.outfit = m.name;
    }
    prevOutfit = next.outfit || prevOutfit;
    return next;
  });
}

// ---------------------------------------------------------------------------
// 给模型看的文本
// ---------------------------------------------------------------------------

function entryLine(it, kindLabel) {
  const parts = [it.name];
  if (it.aliases.length) parts.push(`别名 ${it.aliases.join('/')}`);
  if (it.tags.length) parts.push(`标签 ${it.tags.slice(0, 6).join('、')}`);
  if (it.defaultOutfit) parts.push(`默认服饰：${it.defaultOutfit}`);
  const ctx = Object.entries(it.outfitByContext);
  if (ctx.length) parts.push(`情境穿搭：${ctx.map(([k, v]) => `${k}→${v}`).join('；')}`);
  if (it.desc) parts.push(it.desc);
  return `- ${parts.join('；')}`;
}

/**
 * 给 planEventText 用的素材库列表。
 *
 * 库为空时返回空串（调用方直接判断要不要加这段）。
 * 只列**能帮她写日程的**：人物的习惯、衣柜、场景、道具；不列 desc 里太长的设定文。
 */
export function wardrobeText(lib) {
  if (lib?.empty !== false) return '';
  const sections = [];
  if (lib.characters.length) {
    sections.push(['人物', lib.characters.map((c) => {
      const parts = [c.name];
      if (c.aliases.length) parts.push(`别名 ${c.aliases.join('/')}`);
      if (c.defaultOutfit) parts.push(`平时穿：${c.defaultOutfit}`);
      const ctx = Object.entries(c.outfitByContext);
      if (ctx.length) parts.push(`情境穿搭：${ctx.map(([k, v]) => `${k}→${v}`).join('；')}`);
      return `- ${parts.join('；')}`;
    })]);
  }
  if (lib.outfits.length) {
    sections.push(['衣柜', lib.outfits.map((o) => entryLine(o, 'outfit'))]);
  }
  if (lib.scenes.length) {
    sections.push(['场景', lib.scenes.map((s) => {
      const parts = [s.name];
      if (s.aliases.length) parts.push(`别名 ${s.aliases.join('/')}`);
      if (s.desc) parts.push(s.desc);
      return `- ${parts.join('；')}`;
    })]);
  }
  if (lib.props.length) {
    sections.push(['道具', lib.props.map((p) => entryLine(p, 'prop'))]);
  }
  if (!sections.length) return '';
  const lines = ['（生图素材库里有这些，写日程时 outfit / scene / props 尽量用这里的正名，库里没有的写进 outfitNote：）'];
  for (const [label, items] of sections) {
    lines.push(label + '：');
    lines.push(...items);
  }
  return lines.join('\n');
}

/**
 * 给 envBlock 用的指向句。
 *
 * 库为空时返回空串——没有素材库就没法联动，不强加一句指向不存在的东西。
 * 这句进系统前缀（一天变一两次的），几十 token 常驻。
 */
export function wardrobeHintLine(lib) {
  if (lib?.empty !== false) return '';
  const names = lib.characters.map((c) => c.name).join('、') || '';
  return `（生图工作室的素材库在同一个数据目录下。想发图时，穿着、地点、情境按你日程里写的来——${names ? `尤其是 ${names} ` : ''}的穿搭习惯。imggen_draw 的 outfits / scene / props / situation 填你日程里写的名字就行。）`;
}
