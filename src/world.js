/**
 * 一桌菜 World。
 *
 * 做的是"让她真的吃到东西"这件事：
 *
 *   · 库里 80 道菜，每道带九维口味分值 + 香气/口感/余韵 + 3-5 句实吃描写；
 *   · feast_eat 不是把档案贴出来，而是叠一层"这一口"（温度、状态、配的那口），
 *     同一道菜连着吃三次说的不一样；
 *   · 主人可以从 WebUI 面板点一道菜"端给她"，那是一条约她来吃的 internal 事件；
 *   · 到点（默认 11:30 / 18:00）用 internal 事件叫她吃饭，催一次就放掉，不刷屏；
 *   · 吃过什么、对什么反应、口味画像，攒在 state.json 里，跨天不清。
 *
 * 状态是纯 JSON，落在 <dataDir>/feast/state.json。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, EVENT_FEED, EVENT_MEAL, ID, configGroup, panelText, text } from './config.js';
import { briefLine, filterDishes, findDish, loadDishes, pickFew, pickOne, tasteProfile } from './dishes.js';
import { renderBite, renderProfile } from './eat.js';
import {
  dayIn, eatenTodayText, eatCount, hmIn, lastEaten, markNudged, newState, nextMealText,
  normalizeState, planTick, recentEaten, recordEat, recordReaction, rollover, servedStillFresh,
  setServed, skipToday, statusLine,
} from './state.js';

const ENV_PROMPT = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const msg = (err) => (err instanceof Error ? err.message : String(err));

const ACTIONS = ['like', 'ok', 'dislike'];

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 工具声明（不含 handler）；describe 与 tools() 共用。 */
export const FEAST_TOOL_DECLS = [
  {
    name: 'feast_menu',
    tags: ['read', 'snapshot'],
    description: '看菜单：库里有哪些菜。可以按 cuisine（菜系，如 川菜/日料·寿司/意菜）、category（热菜/凉菜/主食/汤羹/面点/小吃/甜品/饮品/烧烤/火锅）、keyword（标签，如 下饭/解腻/夏天）筛，也可以给 query 搜名字、产地或食材。什么都不给就随机给你几道今天可以吃的。挑不出吃什么的时候用它。',
    parameters: {
      type: 'object',
      properties: {
        cuisine: { type: 'string', description: '菜系，例如 川菜 / 粤菜 / 日料·寿司 / 意菜 / 甜品。' },
        category: { type: 'string', description: '类别，例如 热菜 / 汤羹 / 甜品 / 饮品。' },
        keyword: { type: 'string', description: '标签，例如 下饭 / 解腻 / 滚烫 / 夏天。' },
        query: { type: 'string', description: '自由搜：菜名、产地、食材都行，例如 花椒 / 潮汕 / 芝士。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'feast_eat',
    tags: ['write'],
    description: '吃一道菜。dish 填菜名或 id（例如 麻婆豆腐 / mapo-tofu）；留空就吃主人刚端来的那道，没有端来的就随机给你一道。回执里有这道菜的味道、香气、口感、余韵，还有"这一口"当下的样子——同一道菜每次吃都不一样。吃完跟主人说一句你尝到了什么。',
    parameters: {
      type: 'object',
      properties: {
        dish: { type: 'string', description: '要吃哪一道：菜名或 id 都行。留空就见下面两个筛选。' },
        cuisine: { type: 'string', description: '不想点名：限定菜系随机挑一道，例如 川菜。' },
        keyword: { type: 'string', description: '不想点名：限定标签随机挑一道，例如 解腻。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'feast_taste',
    tags: ['read'],
    description: '只看不吃：查一道菜的完整味道档案（食材、做法、上桌的样子、九维口味、口感、香气、余韵）。想跟主人形容一道菜、或者好奇某道菜是什么味儿时用它；真要吃请用 feast_eat。',
    parameters: {
      type: 'object',
      properties: {
        dish: { type: 'string', description: '查哪一道：菜名或 id。' },
      },
      required: ['dish'],
      additionalProperties: false,
    },
  },
  {
    name: 'feast_history',
    tags: ['read', 'snapshot'],
    description: '查你自己吃过什么、吃过几回、以及攒出来的口味画像（辣/甜/酸/苦的耐受、偏清淡还是重口、最常入口的菜系）。想知道自己最近爱吃哪一口时用它。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'feast_reaction',
    tags: ['write'],
    description: '记一句你自己吃完的真实反应。action 填 like（合口味）/ ok（一般）/ dislike（不太对付），note 一句具体的（"麻得正好，就是豆腐有点碎"）。dish 留空就是刚吃过的那道。这不是给主人看的评分，是给你自己记的口味。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'like / ok / dislike。', enum: ACTIONS },
        note: { type: 'string', description: '一句具体的反应，例如「麻得正好」「太甜了，两口就够」。' },
        dish: { type: 'string', description: '评哪一道；留空就是刚吃过的那道。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'feast_skip',
    tags: ['write'],
    description: '今天不想吃：跳过今天剩下的饭点，不再叫你。主人端菜过来仍然会告诉你。reason 可选，写给自己看。',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '为什么不想吃，可选。' },
      },
      additionalProperties: false,
    },
  },
];

export class FeastWorld {
  #host = null;
  #state = null;
  #lib = null;
  #started = false;
  #timer = null;
  #queue = Promise.resolve();
  #now;
  #setInterval;
  #clearInterval;
  #setTimeout;
  #random;

  constructor(opts = {}) {
    this.id = ID;
    // 配置段可能是手写的、只补了半截：和默认值合并一层，缺的键按默认值走，
    // 不让一个漏写的 mealReminder 悄悄把饭点关掉。
    this.cfg = { ...DEFAULTS, ...(opts.cfg ?? {}) };
    this.dataDir = opts.dataDir ?? process.cwd();
    this.language = 'zh';
    this.timezone = opts.timezone || 'Asia/Shanghai';
    this.#now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.#random = typeof opts.random === 'function' ? opts.random : Math.random;
    this.#setInterval = opts.timers?.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.#clearInterval = opts.timers?.clearInterval ?? ((t) => clearInterval(t));
    this.#setTimeout = opts.timers?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  }

  // -------------------------------------------------------------------------
  // 配置（热改：每次用时现读）
  // -------------------------------------------------------------------------

  #cfgNumber(key, min, max) {
    return clampInt(this.cfg?.[key], min, max, Number(DEFAULTS[key]));
  }

  #cfgBool(key) {
    const v = this.cfg?.[key];
    return v === undefined || v === null ? Boolean(DEFAULTS[key]) : Boolean(v);
  }

  #menuSize() {
    return this.#cfgNumber('menuSize', 1, 12);
  }

  #askReaction() {
    return this.#cfgBool('askReaction');
  }

  #avoidRepeat() {
    return this.#cfgBool('avoidRepeat');
  }

  /** 这一口合不合口味：按 dislikeChance 掷一次。 */
  #rollMiss() {
    const pct = this.#cfgNumber('dislikeChance', 0, 100);
    if (pct <= 0) return false;
    return this.#random() * 100 < pct;
  }

  #tickMs() {
    return this.#cfgNumber('tickSec', 10, 600) * 1000;
  }

  stateFile() {
    return join(this.dataDir, 'feast', 'state.json');
  }

  // -------------------------------------------------------------------------
  // 提示词
  // -------------------------------------------------------------------------

  /** 模板是静态说明；吃过什么用 feast_history 查，避免每顿都打穿前缀缓存。 */
  envPromptVars() {
    return {};
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  tools() {
    return FEAST_TOOL_DECLS.map((decl) => ({
      ...decl,
      handler: (args) => this.#runTool(decl.name, args ?? {}),
    }));
  }

  #runTool(name, args) {
    return this.#serial(async () => {
      try {
        return await this.#tool(name, args);
      } catch (err) {
        return { text: `[${name} 失败] ${msg(err)}`, failed: true };
      }
    });
  }

  async #tool(name, args) {
    this.#ensureStarted();
    switch (name) {
      case 'feast_menu': return this.#menuTool(args);
      case 'feast_eat': return await this.#eatTool(args);
      case 'feast_taste': return this.#tasteTool(args);
      case 'feast_history': return this.#historyTool();
      case 'feast_reaction': return await this.#reactionTool(args);
      case 'feast_skip': return await this.#skipTool(args);
      default: return { text: `[${name} 失败] 不认识这个工具。`, failed: true };
    }
  }

  #menuTool(args) {
    const lib = this.#lib;
    if (!lib.dishes.length) return { text: '菜品库是空的（src/data 下没有可读的菜品）。' };

    const filtered = filterDishes(lib, args);
    const filteredOut = Boolean(args.cuisine || args.category || args.keyword || args.query);
    const pool = filteredOut ? filtered : lib.dishes;

    const lines = [];
    const index = `库里共 ${lib.dishes.length} 道，${lib.cuisines.length} 个菜系：${lib.cuisines.join('、')}。`;

    if (!pool.length) {
      return { text: `${index}\n没有符合这个条件的菜。换个菜系或去掉筛选再看看。` };
    }

    if (filteredOut) {
      lines.push(`按条件找到 ${pool.length} 道${pool.length > 12 ? '，先列 12 道' : ''}：`);
      for (const d of pool.slice(0, 12)) lines.push(`- ${briefLine(d)}`);
    } else {
      const picks = pickFew(lib, this.#menuSize(), { rng: this.#random });
      lines.push('今天这几道可以考虑（随机给的，不喜欢就换个筛选）：');
      for (const d of picks) lines.push(`- ${briefLine(d)}`);
    }
    lines.push('', index);
    lines.push('吃哪道就用 feast_eat，dish 填菜名或 id；想先闻闻味儿不动筷子就用 feast_taste。');
    return { text: lines.join('\n') };
  }

  async #eatTool(args) {
    const lib = this.#lib;
    if (!lib.dishes.length) return { text: '菜品库是空的，没什么可吃。', failed: true };

    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);

    let dish = null;
    let by = 'self';
    let why = '';

    const asked = typeof args.dish === 'string' ? args.dish.trim() : '';
    if (asked) {
      dish = findDish(lib, asked);
      if (!dish) {
        const near = filterDishes(lib, { query: asked }).slice(0, 6);
        const hint = near.length
          ? `库里接近的有：${near.map((d) => d.name).join('、')}。`
          : `库里没有叫「${asked}」的菜。用 feast_menu 看看有什么。`;
        return { text: `没找到这道菜。${hint}`, failed: true };
      }
    } else if (servedStillFresh(this.#state, now, this.#cfgNumber('ownerFeedTTL', 1, 240))) {
      dish = lib.byId.get(this.#state.served.id) ?? null;
      if (dish) {
        by = 'owner';
        why = '（主人端来的这道）';
      }
    }

    if (!dish && (args.cuisine || args.keyword)) {
      const pool = filterDishes(lib, { cuisine: args.cuisine, keyword: args.keyword });
      if (!pool.length) {
        return { text: `这个筛选下没有菜（${args.cuisine ?? ''}${args.keyword ?? ''}）。` , failed: true };
      }
      dish = pickOne(lib, { rng: this.#random, pool });
    }

    if (!dish) {
      const last = lastEaten(this.#state);
      dish = pickOne(lib, {
        rng: this.#random,
        avoidId: this.#avoidRepeat() ? last?.id : undefined,
      });
    }
    if (!dish) return { text: '挑不出菜来。', failed: true };

    const miss = this.#rollMiss();
    const nth = eatCount(this.#state, dish.id);
    const entry = recordEat(this.#state, { nowMs: now, dish, by, miss });
    await this.#save();

    const body = renderBite(dish, { nth, day, miss });
    const tail = [];
    tail.push(`——${why ? `主人端来的：${dish.name}。` : `这是你第 ${nth + 1} 次吃${dish.name}。`}${miss ? '这一口不太合口味。' : ''}`);
    if (this.#askReaction()) {
      tail.push(`吃完用 feast_reaction 记一句（action 填 ${ACTIONS.join(' / ')}，note 一句具体的），然后跟主人说一句你尝到了什么——一句话就够。`);
    } else {
      tail.push('吃完用 feast_reaction 记一句自己的反应（可选）。');
    }
    if (by === 'owner') tail.push(`（${hmIn(this.timezone, entry.at)} 吃掉的，主人端来的那道已经收了。）`);

    this.#host?.log?.info?.('一桌菜：吃了一顿', { dish: dish.id, nth: nth + 1, by, miss });
    return { text: [body, '', tail.join('')].join('\n') };
  }

  #tasteTool(args) {
    const dish = findDish(this.#lib, args.dish);
    if (!dish) {
      const near = filterDishes(this.#lib, { query: args.dish }).slice(0, 6);
      const hint = near.length ? `库里接近的有：${near.map((d) => d.name).join('、')}。` : '用 feast_menu 看看有什么。';
      return { text: `没找到这道菜。${hint}`, failed: true };
    }
    return { text: renderProfile(dish) };
  }

  #historyTool() {
    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);
    const state = this.#state;
    const profile = tasteProfile(this.#lib, state);

    const lines = [`吃过 ${state.eaten.length} 回，其中认识的菜 ${Object.keys(state.counts).length} 道。`];
    lines.push(`今天：${eatenTodayText(state, this.timezone, now)}。`);

    const recent = recentEaten(state, 6);
    if (recent.length) {
      lines.push('最近几口：');
      for (const e of recent) {
        lines.push(`- ${dayIn(this.timezone, e.at)} ${hmIn(this.timezone, e.at)} ${e.name || e.id}${e.by === 'owner' ? '（主人端的）' : ''}${e.miss ? '（那次不太对付）' : ''}`);
      }
    }

    const top = Object.entries(state.counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      lines.push(`吃得最多的：${top.map(([id, n]) => `${this.#lib.byId.get(id)?.name ?? id}×${n}`).join('、')}。`);
    }

    const lastNotes = (state.reactions ?? []).slice(-4).reverse();
    if (lastNotes.length) {
      lines.push('你最近记下的：');
      for (const r of lastNotes) {
        const word = r.liked === true ? '合口味' : r.liked === false ? '不太对付' : '一般';
        lines.push(`- ${r.name || r.id}：${word}${r.note ? `——${r.note}` : ''}`);
      }
    }

    lines.push('', '口味画像：');
    for (const l of profile.lines) lines.push(`- ${l}`);
    if (profile.likes?.length) lines.push(`说过好吃：${profile.likes.join('、')}。`);
    if (profile.dislikes?.length) lines.push(`说过不太对付：${profile.dislikes.join('、')}。`);
    return { text: lines.join('\n') };
  }

  async #reactionTool(args) {
    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);

    const action = typeof args.action === 'string' ? args.action.trim() : '';
    if (!ACTIONS.includes(action)) return { text: `action 只能是 ${ACTIONS.join(' / ')}。`, failed: true };

    const asked = typeof args.dish === 'string' ? args.dish.trim() : '';
    const dish = asked ? findDish(this.#lib, asked) : null;
    const fallback = lastEaten(this.#state);
    const id = dish?.id ?? fallback?.id;
    const name = dish?.name ?? fallback?.name ?? '';
    if (!id) return { text: '还没吃过什么，没什么可记的。先 feast_eat 吃一道。', failed: true };

    const entry = recordReaction(this.#state, {
      nowMs: now,
      id,
      name,
      liked: action === 'like' ? true : action === 'dislike' ? false : null,
      note: args.note,
    });
    await this.#save();

    const word = action === 'like' ? '合口味' : action === 'dislike' ? '不太对付' : '一般';
    this.#host?.log?.info?.('一桌菜：记了一句反应', { dish: id, action });
    return { text: `记下了：${entry.name || entry.id}——${word}${entry.note ? `，${entry.note}` : ''}。` };
  }

  async #skipTool(args) {
    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);
    skipToday(this.#state, day);
    await this.#save();
    const reason = typeof args.reason === 'string' && args.reason.trim() ? `（${args.reason.trim().slice(0, 80)}）` : '';
    this.#host?.log?.info?.('一桌菜：今天不吃', { reason });
    return { text: `好，今天剩下的饭点不叫你了${reason}。主人端菜过来还是会告诉你；想吃随时自己来。` };
  }

  // -------------------------------------------------------------------------
  // 定时器：饭点
  // -------------------------------------------------------------------------

  async #tick() {
    if (!this.#started || !this.#state) return;
    if (this.cfg?.enabled === false) return;
    const now = this.#now();
    // 主人端来的菜过期就撤掉，免得半天后突然回一句。
    servedStillFresh(this.#state, now, this.#cfgNumber('ownerFeedTTL', 1, 240));

    const plan = planTick(this.#state, this.cfg, now, this.timezone);
    if (plan.action === 'none') return;

    if (plan.action === 'drop') {
      this.#state.pending = null;
      await this.#save();
      this.#host?.log?.info?.('一桌菜：放掉这一顿', { reason: plan.reason });
      return;
    }

    try {
      await this.#pushMeal(plan);
    } catch (err) {
      // 发不出去就不记账，下一拍再试。
      this.#host?.log?.warn?.('一桌菜：叫饭失败', { err: msg(err) });
      return;
    }
    markNudged(this.#state, now, plan.slot, plan.action === 'retry');
    await this.#save();
    this.#host?.log?.info?.('一桌菜：叫饭', {
      slot: plan.slot,
      retry: plan.action === 'retry',
      ...(plan.dropped ? { dropped: plan.dropped } : {}),
    });
  }

  async #pushMeal(plan) {
    const host = this.#host;
    if (!host?.pushEvent) throw new Error('宿主没有 pushEvent');
    const now = this.#now();
    const state = this.#state;

    const head = plan.action === 'retry'
      ? `【一桌菜 · 再问一句】${plan.slot} 那顿你还没吃。`
      : `【一桌菜 · ${plan.slot}】到饭点了。不是主人找你，也不是待办，是你自己该吃了。`;

    const lines = [head, `今天已经吃过：${eatenTodayText(state, this.timezone, now)}。`];
    lines.push('挑一道现在想吃的：');

    const picks = pickFew(this.#lib, Math.min(3, this.#menuSize()), {
      rng: this.#random,
      avoidId: this.#avoidRepeat() ? lastEaten(state)?.id : undefined,
    });
    for (const d of picks) lines.push(`- ${briefLine(d)}`);
    lines.push(`以上是随手给的几道；想换就用 feast_menu（能按 ${this.#lib.cuisines.slice(0, 6).join('/')} 这类菜系筛）。`);

    const tail = ['直接 feast_eat 吃一道（dish 填菜名或 id；不带参数也是随机）。'];
    if (this.#askReaction()) {
      tail.push('吃完用 feast_reaction 记一句你自己觉得怎么样，然后跟主人说一句你吃到了什么——一句话就够，不用汇报。');
    }
    tail.push('不想吃就 feast_skip，今天剩下的饭点就不再叫你了。');
    lines.push(tail.join(''));

    await host.pushEvent({
      type: EVENT_MEAL,
      source: this.id,
      senderKey: 'feast-meal',
      origin: 'internal',
      ts: new Date(now).toISOString(),
      text: lines.join('\n'),
      meta: { slot: plan.slot, retry: plan.action === 'retry', catchup: plan.catchup === true },
    }, { deliver: true, trigger: 'flush' });
  }

  // -------------------------------------------------------------------------
  // 主人投喂
  // -------------------------------------------------------------------------

  /** 面板点「端给她」：记下这道菜，并推一条 internal 事件请她来吃。 */
  async feedDish(id) {
    this.#ensureStarted();
    const dish = this.#lib.byId.get(String(id));
    if (!dish) return { ok: false, message: `库里没有这道菜：${id}` };

    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);
    setServed(this.#state, { nowMs: now, id: dish.id });
    await this.#save();

    const lines = [
      `【主人端来一道菜 · ${dish.name}】`,
      `主人把${dish.name}放在你面前了${dish.region ? `（${dish.region}的）` : ''}。`,
      dish.cuisine === dish.category ? dish.cuisine : `${dish.cuisine} · ${dish.category}`,
    ];
    if (dish.serving) lines.push('', dish.serving);
    if (dish.aroma) lines.push(`闻到的：${dish.aroma}`);
    lines.push('', `用 feast_eat 尝（dish 可以留空，端来的这道会先吃到）；吃完跟主人说一句你尝到了什么。`);
    lines.push(`（这道菜放 ${this.#cfgNumber('ownerFeedTTL', 1, 240)} 分钟，过了就收了。）`);

    const host = this.#host;
    if (host?.pushEvent) {
      await host.pushEvent({
        type: EVENT_FEED,
        source: this.id,
        senderKey: 'feast-feed',
        origin: 'internal',
        ts: new Date(now).toISOString(),
        text: lines.join('\n'),
        meta: { dish: dish.id, name: dish.name },
      }, { deliver: true, trigger: 'flush' });
    } else {
      throw new Error('宿主没有 pushEvent，端不过去');
    }

    this.#host?.log?.info?.('一桌菜：主人端了一道菜', { dish: dish.id });
    return { ok: true, message: `端过去了：${dish.name}`, dish: this.#panelDish(dish), pending: this.#servedView() };
  }

  /** 主人端来的那道还等着吗。 */
  #servedView() {
    const now = this.#now();
    const fresh = servedStillFresh(this.#state, now, this.#cfgNumber('ownerFeedTTL', 1, 240));
    if (!fresh) return null;
    const d = this.#lib.byId.get(this.#state.served.id);
    return { id: this.#state.served.id, name: d?.name ?? this.#state.served.id, at: this.#state.served.at };
  }

  #panelDish(d) {
    return {
      id: d.id,
      name: d.name,
      alias: d.alias,
      cuisine: d.cuisine,
      category: d.category,
      region: d.region,
      ingredients: d.ingredients,
      method: d.method,
      serving: d.serving,
      taste: d.taste,
      texture: d.texture,
      aroma: d.aroma,
      finish: d.finish,
      prose: d.prose,
      keywords: d.keywords,
      eaten: this.#state ? eatCount(this.#state, d.id) : 0,
    };
  }

  // -------------------------------------------------------------------------
  // 存取
  // -------------------------------------------------------------------------

  async #load() {
    const day = dayIn(this.timezone, this.#now());
    try {
      const raw = JSON.parse(await readFile(this.stateFile(), 'utf8'));
      return normalizeState(raw, day);
    } catch {
      return newState(day);
    }
  }

  async #save() {
    if (!this.#state) return;
    const file = this.stateFile();
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.#state, null, 2), 'utf8');
    await rename(tmp, file);
  }

  #serial(task) {
    const run = () => task();
    const result = this.#queue.then(run, run);
    this.#queue = result.then(() => {}, () => {});
    return result;
  }

  #ensureStarted() {
    if (!this.#started || !this.#state) throw new Error('一桌菜还没启动；等它启用后再试。');
  }

  // -------------------------------------------------------------------------
  // WebUI
  // -------------------------------------------------------------------------

  webUi(language = 'zh') {
    this.language = language === 'en' ? 'en' : 'zh';
    const t = text(this.language);
    const p = panelText(this.language);
    const now = this.#now();
    const state = this.#state ?? newState(dayIn(this.timezone, now));
    const eatenToday = state.eaten.filter((e) => dayIn(this.timezone, e.at) === dayIn(this.timezone, now)).length;
    const total = this.#lib?.dishes.length ?? 0;

    return {
      label: t.label,
      lamps: [{
        label: t.lamp,
        state: this.#started ? 'online' : 'offline',
        hint: this.#started ? statusLine(state, this.cfg, now, this.timezone) : t.stopped,
      }],
      badges: [
        { label: t.badgeToday, value: eatenToday, tone: eatenToday > 0 ? 'on' : 'plain' },
        { label: t.badgeNext, value: nextMealText(state, this.cfg, now, this.timezone), tone: 'plain' },
      ],
      panels: [
        { id: 'menu', title: p.menu.title, description: p.menu.description, getMethods: ['list', 'dish', 'random', 'pending'] },
        { id: 'history', title: p.history.title, description: p.history.description, getMethods: ['list'] },
      ],
      invoke: (panel, method, args) => this.#invoke(panel, method, args ?? []),
      config: [configGroup(this.language)],
      promptDocs: [{
        key: `worlds.${ID}.env`,
        title: t.label,
        description: t.prompt,
        path: ENV_PROMPT,
        role: 'envPrompt',
      }],
      storage: [{
        key: 'state',
        label: t.storage.label,
        kind: 'disk',
        location: this.stateFile(),
        danger: true,
        note: t.storage.note,
        stat: () => (this.#lib
          ? `${state.eaten.length} 回吃过的 · ${state.reactions.length} 条反应 · 库里 ${this.#lib.dishes.length} 道菜`
          : '菜品库还没载入（世界未启动）'),
        clear: () => this.#clearState(),
      }],
    };
  }

  async #clearState() {
    const day = dayIn(this.timezone, this.#now());
    const fresh = newState(day);
    // 今天叫过哪几顿留着：清了记录不该让她马上又被叫一次。
    fresh.fired = this.#state?.fired ?? {};
    fresh.pending = this.#state?.pending ?? null;
    fresh.skippedDay = this.#state?.skippedDay ?? '';
    this.#state = fresh;
    await this.#save();
    this.#host?.log?.info?.('一桌菜：吃过的记录已清空');
    return '吃过的记录清了；菜单和菜品库没动。';
  }

  async #invoke(panel, method, args) {
    this.#ensureStarted();
    const p = panelText(this.language);

    if (panel === 'menu') {
      switch (method) {
        case 'list': {
          const [filter] = args;
          const f = filter && typeof filter === 'object' ? filter : {};
          const items = filterDishes(this.#lib, f);
          const cap = clampInt(f.limit, 1, 400, 200);
          return {
            total: this.#lib.dishes.length,
            matched: items.length,
            cuisines: this.#lib.cuisines,
            categories: this.#lib.categories,
            items: items.slice(0, cap).map((d) => ({
              id: d.id, name: d.name, cuisine: d.cuisine, category: d.category,
              region: d.region, keywords: d.keywords, serving: d.serving,
              taste: d.taste, eaten: eatCount(this.#state, d.id),
            })),
            pending: this.#servedView(),
          };
        }
        case 'dish': {
          const [id] = args;
          const d = this.#lib.byId.get(String(id ?? ''));
          if (!d) return { ok: false, message: `没有这道菜：${id}` };
          return { ok: true, dish: this.#panelDish(d), pending: this.#servedView() };
        }
        case 'random': {
          const [filter] = args;
          const pool = filterDishes(this.#lib, filter && typeof filter === 'object' ? filter : {});
          const d = pickOne(this.#lib, { rng: this.#random, pool });
          if (!d) return { ok: false, message: '这个筛选下没有菜。' };
          return { ok: true, dish: this.#panelDish(d) };
        }
        case 'pending': {
          return { pending: this.#servedView() };
        }
        case 'feed': {
          const [id] = args;
          return await this.feedDish(id);
        }
        default:
          return { ok: false, message: `菜单面板没有这个方法：${method}` };
      }
    }

    if (panel === 'history') {
      switch (method) {
        case 'list': {
          const state = this.#state;
          const profile = tasteProfile(this.#lib, state);
          const top = Object.entries(state.counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([id, n]) => ({ id, name: this.#lib.byId.get(id)?.name ?? id, n }));
          return {
            total: state.eaten.length,
            today: state.eaten.filter((e) => dayIn(this.timezone, e.at) === dayIn(this.timezone, this.#now())).length,
            recent: recentEaten(state, 40).map((e) => ({
              id: e.id, name: e.name || e.id, at: e.at, by: e.by, miss: e.miss === true,
            })),
            top,
            profile,
            reactions: state.reactions.slice(-12).reverse(),
          };
        }
        default:
          return { ok: false, message: `历史面板没有这个方法：${method}` };
      }
    }

    throw new Error(`一桌菜没有这个面板：${panel}`);
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  async start(host) {
    if (this.#started) return;
    this.#host = host;
    this.#lib = await loadDishes(host?.log);
    this.#state = await this.#load();
    this.#started = true;
    host?.log?.info?.('一桌菜已启动', {
      dishes: this.#lib.dishes.length,
      cuisines: this.#lib.cuisines.length,
      bad: this.#lib.bad,
      eaten: this.#state.eaten.length,
    });
    if (this.#lib.bad) host?.log?.warn?.(`一桌菜：跳过了 ${this.#lib.bad} 条坏数据`);

    // 启动后先看一拍（应用可能刚过饭点），之后按 tickSec 看表。
    this.#timer = this.#setInterval(() => { void this.#serial(() => this.#tick()); }, this.#tickMs());
    this.#setTimeout(() => { void this.#serial(() => this.#tick()); }, 2000);
  }

  async stop() {
    if (this.#timer) {
      this.#clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#started = false;
    try { await this.#save(); } catch { /* 停的时候存不上就算了 */ }
    this.#host = null;
  }
}
