/**
 * 一桌菜 World。
 *
 * 做的是"让她真的吃到东西"这件事：
 *
 *   · 库里 700 道地域菜 + 白米饭 1 道（28 个菜系组），每道带九维口味分值 + 香气/口感/余韵 + 实吃描写；
 *     cuisine 只说地域/传统，形态一律看 category；
 *     唯一允许的非地域组是 `staples`（白饭），里面只有白米饭一碗，有守门测试钉死上限；
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

import {
  DEFAULTS, EVENT_FEED, EVENT_MEAL, EVENT_TABLE, EVENT_TOGETHER, ID, configGroup, panelText, text,
} from './config.js';
import { briefLine, filterDishes, findDish, findDishExact, loadDishes, pickFew, pickOne, tasteProfile } from './dishes.js';
import {
  MAX_TABLE, PRESETS, adhocCombo, comboIdFrom, comboProblem, comboSize, findCombo, findPreset,
  normalizeCombo, resolveCombo, tableLine, tableTaste,
} from './combos.js';
import { renderBite, renderProfile } from './eat.js';
import {
  dayIn, eatenMarkOf, eatenSince, eatenTodayText, eatCount, hmIn, lastEaten, markNudged, newState,
  nextMealText, normalizeState, planTick, recentEaten, recordEat, recordReaction, rollover,
  servedRemaining, servedStillFresh, setServed, skipToday, statusLine,
} from './state.js';
import {
  addBack, addBite, answerBack, biteCount, clearInvite, dropStaleInvite, finishTogether,
  inviteLeftMin, isTogether, lastOwnerAte, makeInvite, pendingBack, setOwnerAte, startTogether,
  togetherView, togetherWhy,
} from './together.js';

const ENV_PROMPT = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const msg = (err) => (err instanceof Error ? err.message : String(err));

const ACTIONS = ['like', 'ok', 'dislike'];

/** 端来的菜还剩多久（四舍五入到分钟；不到一分钟就说不到一分钟）。 */
function shelfLifeText(remainMs) {
  const min = Math.round(remainMs / 60_000);
  return min >= 1 ? `还剩约 ${min} 分钟` : '只剩不到一分钟';
}

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
    description: '看菜单：库里有哪些菜。可以按 cuisine（菜系，如 川菜/日料/意菜/中东菜）、category（热菜/凉菜/主食/汤羹/面点/小吃/甜品/饮品/烧烤/火锅）、keyword（标签，如 下饭/解腻/夏天）筛，也可以给 query 搜名字、产地或食材。什么都不给就随机给你几道今天可以吃的。挑不出吃什么的时候用它。',
    parameters: {
      type: 'object',
      properties: {
        cuisine: { type: 'string', description: '菜系（地域/传统），例如 川菜 / 粤菜 / 日料 / 意菜 / 中东菜。⚠ 这里只说从哪来，不管是什么形态；想按汤/面/小吃挑请用 category。' },
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
  {
    name: 'feast_combos',
    tags: ['read', 'snapshot'],
    description: '看有哪些套餐（一桌菜）：内置的现成套餐 + 主人自己攒的那些。每一套都会现配出具体的菜名给你看。想"有没有现成的一桌"、或者想看看主人平时给你配什么时用它。',
    parameters: {
      type: 'object',
      properties: {
        resolve: { type: 'boolean', description: '要不要把每套现配成具体菜名（默认 true；只看名字时可以关掉，省得一屏全是菜名）。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'feast_combo',
    tags: ['write'],
    description: '开一桌：把一个套餐配成具体的几道菜，摆到你面前，一道一道吃。combo 填套餐名或 id（例如 四菜一汤 / 清爽一餐）；留空就按你的口味现配一桌。整桌摆上来之后，feast_eat 不带 dish 就会吃桌上还没吃的那道。',
    parameters: {
      type: 'object',
      properties: {
        combo: { type: 'string', description: '哪一套：套餐名或 id。留空 = 现配一桌。' },
        size: { type: 'integer', description: '留空且没给 combo 时，现配几道（1–12，默认按配置）。', minimum: 1, maximum: 12 },
        cuisine: { type: 'string', description: '想"一桌同一个菜系"时填，例如 川菜 / 日料。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'feast_together',
    tags: ['write'],
    description: '陪主人一起吃饭。action 填 invite（问主人要不要一起吃——面板上会挂一条等他回应，但话得你自己在聊天里说出来）、feed（从库里挑一道分他一口，他会看到、可以接过去）、end（这顿到这儿了）。他喂你的一口和他自己吃什么，你会收到事件；你自己吃饭还是用 feast_eat。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'invite / feed / end。', enum: ['invite', 'feed', 'end'] },
        dish: { type: 'string', description: 'action=feed 时要分他的那道：菜名或 id。' },
        note: { type: 'string', description: '一句话，可选；invite 时是"想一起吃什么"的由头，end 时是为什么先收了。' },
      },
      required: ['action'],
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
  /** 主人攒的桌（懒加载，见 #loadCombos）。 */
  #combos = null;

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

  /**
   * 自定义套餐单独一个文件，**不进 state.json**。
   *
   * 因为它是主人写的内容，不是"她吃过什么"的记录：面板上点「清空吃过的记录」
   * 不该顺手把主人攒的桌一起删掉。
   */
  combosFile() {
    return join(this.dataDir, 'feast', 'combos.json');
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
      case 'feast_combos': return await this.#combosTool(args);
      case 'feast_combo': return await this.#comboTool(args);
      case 'feast_together': return await this.#togetherTool(args);
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

    let servedAt = 0;
    let servedTtlMin = 0;
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
    } else {
      servedTtlMin = this.#cfgNumber('ownerFeedTTL', 1, 240);
      if (servedStillFresh(this.#state, now, servedTtlMin)) {
        // 端来的可能是一桌：吃这一桌里**还没吃的那道**。
        const remaining = servedRemaining(this.#state);
        dish = remaining.length ? (lib.byId.get(remaining[0]) ?? null) : null;
        if (dish) {
          by = 'owner';
          why = this.#state.served?.name
            ? `（主人端来的这一桌：${this.#state.served.name}）`
            : '（主人端来的这道）';
          servedAt = this.#state.served.at;
        }
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
    // 吃掉之前先记下这一桌还剩几道（recordEat 之后 served 可能已经收了）。
    const tableBefore = by === 'owner' && this.#state.served?.ids?.length > 1 ? this.#state.served : null;
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
    if (tableBefore) {
      // 一桌：说清还剩哪几道，不然她不知道还有没有下一道。
      const left = servedRemaining(this.#state);
      const leftNames = left.map((id) => lib.byId.get(id)?.name ?? id);
      if (leftNames.length) {
        tail.push(`（这一桌${tableBefore.name ? `「${tableBefore.name}」` : ''}共 ${tableBefore.ids.length} 道，还剩 ${leftNames.length} 道：${leftNames.join('、')}。）`);
      } else {
        tail.push('（这一桌吃完了。）');
      }
    }
    if (by === 'owner') {
      const left = servedAt + servedTtlMin * 60_000 - now;
      tail.push(`（${hmIn(this.timezone, entry.at)} 吃掉的；端来时${shelfLifeText(left)}。）`);
    }

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
        lines.push(`- ${dayIn(this.timezone, e.at)} ${hmIn(this.timezone, e.at)} ${e.name || e.id}${eatenMarkOf(e)}${e.miss ? '（那次不太对付）' : ''}`);
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
    // 一起吃饭这一顿到点也自己散（面板没开着也得散）。
    await this.#togetherSettle();

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
    const ttlMin = this.#cfgNumber('ownerFeedTTL', 1, 240);
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
    // 只写"放 30 分钟"她不知道还剩多久；把到点的那一刻写出来，她才能自己看表决定先吃哪个。
    lines.push(`（现在刚端过来，${hmIn(this.timezone, now + ttlMin * 60_000)} 之前吃掉都算数；过了就收了。）`);

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

  /**
   * 面板点「端这一桌」：把一桌子菜一起端过去。
   *
   * 和 feedDish 分开而不是合成一个：两者的正文不一样（一道菜说"尝这一道"，
   * 一桌要说清几道、怎么个吃法、还剩几道），事件类型也不一样。
   */
  async feedCombo(combo, dishes, seed) {
    this.#ensureStarted();
    if (!dishes?.length) return { ok: false, message: '这一桌配不出菜来。' };

    const now = this.#now();
    const ttlMin = this.#cfgNumber('ownerFeedTTL', 1, 240);
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);
    setServed(this.#state, {
      nowMs: now,
      ids: dishes.map((d) => d.id),
      name: combo?.name ?? '一桌菜',
      comboId: combo?.id ?? '',
    });
    await this.#save();

    const name = combo?.name ?? '一桌菜';
    const lines = [
      `【主人端来一桌菜 · ${name}】`,
      `主人摆了${dishes.length}道菜在你面前：`,
      ...dishes.map((d, i) => `${i + 1}. ${d.name}${d.cuisine === d.category ? `（${d.cuisine}）` : `（${d.cuisine} · ${d.category}）`}`),
    ];
    const taste = tableTaste(dishes);
    if (taste) lines.push('', `这一桌合起来${tableLine(taste)}。`);
    lines.push('', '用 feast_eat 一道一道吃（dish 留空就吃这一桌里还没吃的那道）；吃完跟主人说一句你尝到了什么。');
    lines.push(`（现在刚摆上，${hmIn(this.timezone, now + ttlMin * 60_000)} 之前吃掉都算数；过了就收了。）`);

    const host = this.#host;
    if (host?.pushEvent) {
      await host.pushEvent({
        type: EVENT_TABLE,
        source: this.id,
        senderKey: 'feast-table',
        origin: 'internal',
        ts: new Date(now).toISOString(),
        text: lines.join('\n'),
        meta: { combo: combo?.id ?? '', name, ids: dishes.map((d) => d.id), seed: seed ?? '' },
      }, { deliver: true, trigger: 'flush' });
    } else {
      throw new Error('宿主没有 pushEvent，端不过去');
    }

    this.#host?.log?.info?.('一桌菜：主人端了一桌', { combo: combo?.id, n: dishes.length });
    return {
      ok: true,
      message: `端过去了：${name}（${dishes.length} 道）`,
      combo: { id: combo?.id ?? '', name, size: dishes.length },
      dishes: dishes.map((d) => ({ id: d.id, name: d.name, cuisine: d.cuisine, category: d.category })),
      pending: this.#servedView(),
    };
  }

  /** 主人端来的那道/那桌还等着吗。ttlMin 给面板自己算还剩多久。 */
  #servedView() {
    const now = this.#now();
    const ttlMin = this.#cfgNumber('ownerFeedTTL', 1, 240);
    const fresh = servedStillFresh(this.#state, now, ttlMin);
    if (!fresh) return null;
    const s = this.#state.served;
    const remaining = servedRemaining(this.#state);
    const named = remaining
      .map((id) => this.#lib.byId.get(id))
      .filter(Boolean);
    // 还剩一道而且端来时就一道：保持 0.6.0 的形状（面板上那行"端来的一道菜"不用改）。
    const single = !s.name && s.ids.length === 1;
    return {
      id: s.ids[0],
      name: named[0]?.name ?? s.ids[0],
      at: s.at,
      ttlMin,
      // 一桌的额外信息。面板按 total 判断是不是一桌，单道时这些也填着，不影响旧渲染。
      total: s.ids.length,
      remaining: remaining.length,
      left: named.map((d) => d.name),
      tableName: s.name || '',
      comboId: s.comboId || '',
      isTable: !single,
    };
  }

  // -------------------------------------------------------------------------
  // 陪主人吃饭
  //
  // 两条方向天生不对称：主人 → 她走 pushEvent（这里所有 #pushTogether）；
  // 她 → 主人没有通道，只能"面板上挂一条待回应 + 她自己说出口"。
  // 账要分清：喂的一口进 eaten（带 bite），她回喂和主人自己吃的不进（见 together.js）。
  // -------------------------------------------------------------------------

  #togetherTtlMin() {
    return this.#cfgNumber('togetherTTLMin', 1, 600);
  }

  #togetherInviteMin() {
    return this.#cfgNumber('togetherInviteMin', 1, 240);
  }

  #togetherMaxInvites() {
    return this.#cfgNumber('togetherMaxInvites', 0, 5);
  }

  /**
   * 惰性收摊：把到点的邀请放掉、把该散的一顿散掉。
   * 面板一读就顺手做（不用等下一拍），饭点那一拍也会调它。
   */
  async #togetherSettle() {
    const now = this.#now();
    const t = this.#state.together;
    dropStaleInvite(t, now, this.#togetherInviteMin());
    if (!isTogether(t)) return false;
    const why = togetherWhy(t, {
      nowMs: now,
      ttlMin: this.#togetherTtlMin(),
      ateSince: eatenSince(this.#state, t.at),
      tableEmpty: servedRemaining(this.#state).length === 0,
    });
    if (!why) return false;
    // 「吃完了」不另发一条：她刚在 feast_eat 的回执里看到"这一桌吃完了"。
    await this.#finishTogether(why, { push: why === 'ttl' });
    return true;
  }

  /** 面板会话条要的那一份。 */
  #togetherView() {
    return togetherView(this.#state.together, {
      nowMs: this.#now(),
      ttlMin: this.#togetherTtlMin(),
      inviteWindowMin: this.#togetherInviteMin(),
    });
  }

  /** 收摊：记 lastEnd、存盘，必要时告诉她。 */
  async #finishTogether(why, { push = false } = {}) {
    const ended = finishTogether(this.#state.together, { nowMs: this.#now(), why });
    if (!ended) return null;
    await this.#save();
    this.#host?.log?.info?.('一桌菜：这一顿散了', { why, bites: ended.bites });
    if (push) await this.#pushTogether(this.#endLines(ended), { kind: 'end', why });
    return ended;
  }

  #endLines(ended) {
    const why = ended.why === 'finished' ? '你那份吃完了'
      : ended.why === 'ttl' ? '这顿挂得有点久，到点收摊了'
        : ended.why === 'her' ? '你先说收了' : '主人说散了';
    const lines = [`【一起吃饭 · 这顿散了】${why}。`];
    if (ended.bites) lines.push(`（这一顿他一共喂了你 ${ended.bites} 口。）`);
    lines.push('想吃随时自己来：feast_menu 挑一道，或者 feast_combo 开一桌。');
    return lines;
  }

  /** 一起吃饭这一条通道：邀请 / 喂一口 / 主人自己吃什么 / 回喂的回应 / 散桌。 */
  async #pushTogether(lines, meta = {}) {
    const host = this.#host;
    if (!host?.pushEvent) throw new Error('宿主没有 pushEvent，说不过去');
    await host.pushEvent({
      type: EVENT_TOGETHER,
      source: this.id,
      senderKey: 'feast-together',
      origin: 'internal',
      ts: new Date(this.#now()).toISOString(),
      text: lines.filter(Boolean).join('\n'),
      meta,
    }, { deliver: true, trigger: 'flush' });
  }

  /** 面板点「一起吃」：主人邀请她。 */
  async inviteTogether(note = '') {
    this.#ensureStarted();
    const t = this.#state.together;
    if (isTogether(t)) return { ok: false, message: '你们已经在一起吃了。' };
    const said = typeof note === 'string' ? note.trim().slice(0, 120) : '';
    startTogether(t, { nowMs: this.#now(), starter: 'owner' });
    await this.#save();

    await this.#pushTogether([
      '【一起吃饭 · 主人问你】主人问你要不要一起吃点什么。',
      said ? `他说：${said}` : '',
      '',
      '想一起就应一声，然后 feast_eat 吃（dish 留空就吃桌上还没吃的那道，桌上没有就先挑一道）；也可以 feast_together（action 填 feed，dish 填菜名）分他一口。',
      '他喂你一口、或者他自己吃了什么，都会告诉你。不想吃就直说——feast_skip 管的是饭点提醒，不管这个。',
    ], { kind: 'invite' });

    this.#host?.log?.info?.('一桌菜：邀请她一起吃');
    return { ok: true, message: '问她了：一起吃点？', together: this.#togetherView() };
  }

  /** 面板点「喂她一口」：夹一筷子递过去。进 eaten（所以 nth 接着数），但不消耗桌上的菜。 */
  async biteTogether(id) {
    this.#ensureStarted();
    const dish = this.#lib.byId.get(String(id ?? ''));
    if (!dish) return { ok: false, message: `库里没有这道菜：${id}` };
    const t = this.#state.together;
    if (!isTogether(t)) return { ok: false, message: '现在没在一起吃；先点「一起吃」邀请她。' };

    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);
    const nth = eatCount(this.#state, dish.id);
    const miss = this.#rollMiss();
    recordEat(this.#state, { nowMs: now, dish, by: 'owner', miss, bite: true });
    addBite(t, { nowMs: now, dish, nth });
    await this.#save();

    const count = biteCount(t, dish.id);
    await this.#pushTogether([
      `【一起吃饭 · 主人喂你一口】主人夹了${dish.name}递到你嘴边。`,
      '',
      renderBite(dish, { nth, day, miss }),
      '',
      `（这一顿他喂你的第 ${count} 口${miss ? '，这一口不太合口味' : ''}；${dish.cuisine === dish.category ? dish.cuisine : `${dish.cuisine} · ${dish.category}`}。）`,
      this.#askReaction() ? '说一句这一口什么味儿——一句话就够。' : '',
    ], { kind: 'bite', dish: dish.id, name: dish.name });

    this.#host?.log?.info?.('一桌菜：喂了她一口', { dish: dish.id, nth });
    return { ok: true, message: `喂了一口：${dish.name}`, together: this.#togetherView() };
  }

  /**
   * 面板记「主人也在吃」：库里点一道（`id`），或者写一句（`note`）。
   *
   * 那一句**先当菜名查一次库**（只认精确匹配，见 findDishExact）：主人写「麻婆豆腐」时，
   * 回一句"库里没有这道"是不实的——库里明明有。查中了就按库里那道记（带菜系、进她的口味账），
   * 查不中才是自由文本（这时如实说明"这条没进库、只按他说的这句写"）。
   */
  async takeTogether({ id = '', note = '' } = {}) {
    this.#ensureStarted();
    const t = this.#state.together;
    if (!isTogether(t)) return { ok: false, message: '现在没在一起吃；先点「一起吃」邀请她。' };

    const want = String(id ?? '').trim();
    let dish = want ? (this.#lib.byId.get(want) ?? null) : null;
    if (want && !dish) return { ok: false, message: `库里没有这道菜：${want}` };

    let text = String(note ?? '').trim();
    let matched = false;
    if (!dish && text) {
      dish = findDishExact(this.#lib, text);
      if (dish) {
        matched = true;
        text = '';
      }
    }

    const entry = setOwnerAte(t, { nowMs: this.#now(), dish, note: text });
    if (!entry) return { ok: false, message: '要说清你吃的是哪道，或者写一句你在吃什么。' };
    await this.#save();

    const lines = entry.kind === 'dish'
      ? [
        `【一起吃饭 · 主人也在吃】主人说他这会儿也在吃：${dish.name}（${dish.cuisine === dish.category ? dish.cuisine : `${dish.cuisine} · ${dish.category}`}）。`,
        dish.serving ? `他那份的样子：${dish.serving}` : '',
        matched ? '（他没点名，是照他写的那句对上了库里这一道。）' : '',
        '（你们在吃同一道/同一桌东西——可以顺势聊聊这一口。）',
      ]
      : [
        `【一起吃饭 · 主人也在吃】主人说他${entry.note}。`,
        '（**这条没进库**：只按他说的这句话写，别拿库里别的菜替他形容。）',
      ];
    await this.#pushTogether(lines, { kind: 'owner-ate', ...(dish ? { dish: dish.id, name: dish.name } : {}) });

    this.#host?.log?.info?.('一桌菜：主人也吃了点什么', { kind: entry.kind, matched });
    const said = entry.kind === 'dish'
      ? (matched
        ? `记下了：你在吃${dish.name}——这句正好是库里那道，按它记了。`
        : `记下了：他也在吃${dish.name}。`)
      : '记下了：他也在吃他自己那份（只按你说的这句记）。';
    return { ok: true, message: said, together: this.#togetherView() };
  }

  /** 面板点「好，一起吃」：接住她的邀请。这对她来说也是主人开口了，所以要推事件。 */
  async acceptTogether() {
    this.#ensureStarted();
    const t = this.#state.together;
    if (isTogether(t)) return { ok: false, message: '你们已经在一起吃了。' };
    if (!t.invite) return { ok: false, message: '她现在没有挂着邀请。' };

    startTogether(t, { nowMs: this.#now(), starter: 'her' });
    await this.#save();

    await this.#pushTogether([
      '【一起吃饭 · 主人应了】你刚才问他要不要一起吃，他应了：好，一起吃。',
      '那就 feast_eat 吃起来（dish 留空就吃桌上还没吃的那道）；也可以 feast_together（action 填 feed）分他一口。',
    ], { kind: 'invite', accepted: true });

    this.#host?.log?.info?.('一桌菜：接住了一起吃的邀请');
    return { ok: true, message: '应了：这顿一起吃。', together: this.#togetherView() };
  }

  /** 面板点「今天不了」：把她的邀请收掉。**不推事件**——回绝请直接在她聊天里说。 */
  async declineTogether() {
    this.#ensureStarted();
    if (!clearInvite(this.#state.together)) return { ok: false, message: '她现在没有挂着邀请。' };
    await this.#save();
    return {
      ok: true,
      message: '收掉了。她不会收到提示——要回绝就直接在聊天里跟她说一句。',
      together: this.#togetherView(),
    };
  }

  /** 面板点「接过来 / 下次吧」：回应她的回喂。 */
  async replyTogether(ok = true) {
    this.#ensureStarted();
    const g = answerBack(this.#state.together, { ok: ok === true });
    if (!g) return { ok: false, message: '没有等着回应的——她还没分你什么。' };
    await this.#save();

    await this.#pushTogether(ok === true
      ? [
        `【一起吃饭 · 主人接住了】你刚才分他的${g.name || g.id}，他接过去吃了。`,
        '（他也在吃你爱吃的东西——这顿算两个人的。）',
      ]
      : [
        `【一起吃饭 · 主人这次没要】你刚才分他的${g.name || g.id}，他这次没要。`,
        '（大概是客气或者吃不下，不是不喜欢。别追问，也别往心里去。）',
      ], { kind: 'back', dish: g.id, name: g.name, accepted: ok === true });

    this.#host?.log?.info?.('一桌菜：回喂的回应', { dish: g.id, accepted: ok === true });
    return {
      ok: true,
      message: ok === true ? `记下了：他吃了${g.name || g.id}。` : '记下了：这次没要。',
      together: this.#togetherView(),
    };
  }

  /** 面板点「散桌」。 */
  async endTogether() {
    this.#ensureStarted();
    if (!isTogether(this.#state.together)) return { ok: false, message: '现在没在一起吃。' };
    const ended = await this.#finishTogether('owner', { push: true });
    return {
      ok: true,
      message: `散了${ended?.bites ? `（他一共喂了她 ${ended.bites} 口）` : ''}。`,
      together: this.#togetherView(),
    };
  }

  /** feast_together：她自己这一边的三个动作。 */
  async #togetherTool(args) {
    const now = this.#now();
    const day = dayIn(this.timezone, now);
    rollover(this.#state, day);
    const action = typeof args?.action === 'string' ? args.action.trim() : '';
    const note = typeof args?.note === 'string' ? args.note.trim().slice(0, 200) : '';

    if (action === 'invite') return await this.#togetherInviteTool(note, now, day);
    if (action === 'feed') return await this.#togetherFeedTool(args, now);
    if (action === 'end') return await this.#togetherEndTool(note);
    return { text: 'action 只能是 invite（问主人要不要一起吃）/ feed（分他一口）/ end（这顿先收了）。', failed: true };
  }

  async #togetherInviteTool(note, now, day) {
    const t = this.#state.together;
    if (isTogether(t)) {
      return { text: '你们已经在一起吃了——直接 feast_eat 吃，或者 feast_together（action 填 feed）分他一口。' };
    }
    const max = this.#togetherMaxInvites();
    const win = this.#togetherInviteMin();
    const r = makeInvite(t, { nowMs: now, day, max, windowMin: win });
    if (!r.ok) {
      if (r.reason === 'hanging') {
        return {
          text: `你已经挂了一条在等他回应（还剩约 ${r.leftMin} 分钟），别急着问第二遍。真想说，就在聊天里顺口提一句。`,
          failed: true,
        };
      }
      return {
        text: `今天主动邀请的次数用完了（配置里是一天 ${max} 次）。他要是自己在聊天里问起，你当然可以答应；但别再硬凑一个由头。`,
        failed: true,
      };
    }

    await this.#save();
    return {
      text: [
        '挂上了：主人一开面板就看得见你问过。',
        '**但他听不到这句话**——你得自己在聊天里跟他说一句（"今晚一起吃点什么？"这样，一句就够）。',
        note ? `你记下的由头：${note}` : '',
        `这条挂 ${win} 分钟，他没回应就自己收掉，不会再催你；今天还能主动邀请 ${Math.max(0, max - r.used)} 次。`,
      ].filter(Boolean).join('\n'),
    };
  }

  async #togetherFeedTool(args, now) {
    const asked = typeof args?.dish === 'string' ? args.dish.trim() : '';
    if (!asked) return { text: '要分主人一口，得说清是哪一道：dish 填菜名或 id。', failed: true };
    const dish = findDish(this.#lib, asked);
    if (!dish) {
      const near = filterDishes(this.#lib, { query: asked }).slice(0, 6);
      const hint = near.length ? `库里接近的有：${near.map((d) => d.name).join('、')}。` : '用 feast_menu 看看有什么。';
      return { text: `没找到这道菜。${hint}`, failed: true };
    }

    const t = this.#state.together;
    // 分他一口就是一起吃的开始——不用先走一遍邀请。
    if (!isTogether(t)) startTogether(t, { nowMs: now, starter: 'her' });
    addBack(t, { nowMs: now, dish });
    await this.#save();

    const mine = eatCount(this.#state, dish.id);
    return {
      text: [
        `分过去了：${dish.name}${dish.serving ? `（${dish.serving}）` : ''}。`,
        mine ? `你自己吃过 ${mine} 回，这一口是熟客推荐。` : '你自己还没吃过这道，那就是"我也刚发现"的语气。',
        '面板上他看得见；接不接由他，他接过去（或者没要）之后会告诉你——不用追问。',
        '你那份还在，接着 feast_eat 吃就行。',
      ].join('\n'),
    };
  }

  async #togetherEndTool(note) {
    const t = this.#state.together;
    if (!isTogether(t)) return { text: '现在没在一起吃（没有开着的这一顿）。', failed: true };
    const ended = await this.#finishTogether('her', { push: false });
    return {
      text: [
        `好，这顿到这儿了${ended?.bites ? `（他一共喂了你 ${ended.bites} 口）` : ''}。`,
        note ? `你自己记一句：${note}` : '',
        '面板上他会看到收摊了。自己想吃随时再开一桌。',
      ].filter(Boolean).join('\n'),
    };
  }

  /**
   * 面板上那张套餐卡。
   *
   * `seed` 由面板给（见 combo/list 的 opts.seeds）：**卡上列出来的几道，和
   * 「端这一桌」端过去的必须是同一颗种子配出来的那一桌**。缺省仍是
   * `<comboId>|panel`，别的调用方（feast_combos / combo/pick）行为不变。
   */
  #panelCombo(combo, resolve = true, seed = '') {
    const size = comboSize(combo);
    const view = {
      id: combo.id,
      name: combo.name,
      desc: combo.desc ?? '',
      kind: combo.kind ?? 'preset',
      size,
      slots: (combo.slots ?? []).map((s) => s.label ?? ''),
      dishes: [],
      missing: [],
      line: '',
      taste: null,
    };
    if (resolve) {
      const { dishes, missing, line, taste } = this.#resolve(combo, seed || `${combo.id}|panel`);
      view.dishes = dishes.map((d) => ({
        id: d.id, name: d.name, cuisine: d.cuisine, category: d.category,
      }));
      view.missing = missing;
      view.line = line;
      view.taste = taste;
    }
    // 固定桌（主人攒的）要能回面板上"改"：把勾选的原样给出去。
    if (Array.isArray(combo.dishes) && combo.dishes.length) view.picked = combo.dishes.slice();
    return view;
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

  // -------------------------------------------------------------------------
  // 套餐（自定义的存取）
  // -------------------------------------------------------------------------

  /** 读主人攒的桌。坏文件/坏条目跳过，不抛——一个手改坏的 json 不该让整页打不开。 */
  async #loadCombos() {
    if (Array.isArray(this.#combos)) return this.#combos;
    let raw = null;
    try {
      raw = JSON.parse(await readFile(this.combosFile(), 'utf8'));
    } catch {
      raw = null;
    }
    const list = Array.isArray(raw?.combos) ? raw.combos : Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const c = normalizeCombo(item);
      if (!c) continue;
      // 没有 id 的（手写的）补一个；撞了加序号。
      if (!c.id) c.id = comboIdFrom(c.name, seen);
      if (seen.has(c.id)) c.id = comboIdFrom(`${c.id}-2`, seen);
      seen.add(c.id);
      out.push(c);
    }
    this.#combos = out;
    return out;
  }

  async #saveCombos(list) {
    this.#combos = list;
    const file = this.combosFile();
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ combos: list }, null, 2), 'utf8');
    await rename(tmp, file);
  }

  /** 预设 + 自定义，合成一份给面板和工具用。预设排在前面。 */
  async #allCombos() {
    const custom = await this.#loadCombos();
    return [...PRESETS.map((c) => ({ ...c, kind: 'preset' })), ...custom];
  }

  /**
   * 把一张桌配成具体的菜。
   *
   * 口味画像现算；她标记过 dislike 的菜不进桌；上一顿吃过的那道降到最后。
   */
  #resolve(combo, seed = '') {
    const profile = tasteProfile(this.#lib, this.#state);
    const dislikes = this.#state.reactions.filter((r) => r.liked === false).map((r) => r.id);
    const last = lastEaten(this.#state);
    return resolveCombo(this.#lib, combo, {
      avg: profile?.empty ? null : profile?.avg ?? null,
      seed,
      exclude: dislikes,
      demote: this.#avoidRepeat() ? last?.id ?? null : null,
    });
  }

  async #combosTool(args) {
    const withDishes = args?.resolve !== false;
    const all = await this.#allCombos();

    const lines = [`共 ${all.length} 套（内置 ${PRESETS.length} 套，你自己攒的 ${all.length - PRESETS.length} 套）：`];
    for (const c of all) {
      const size = comboSize(c);
      const head = `- ${c.name}（${size} 道${c.kind === 'custom' ? '，主人攒的' : ''}）${c.desc ? `：${c.desc}` : ''}`;
      if (!withDishes) { lines.push(head); continue; }
      const { dishes, missing } = this.#resolve(c, c.id);
      lines.push(`${head}\n  现配：${dishes.map((d) => d.name).join('、') || '（配不出来）'}`);
      if (missing.length) lines.push(`  说明：${missing.join('；')}`);
    }
    lines.push('', '用 feast_combo 开一桌（combo 填名字或 id，留空就按你的口味现配）。');
    return { text: lines.join('\n') };
  }

  async #comboTool(args) {
    const ref = typeof args?.combo === 'string' ? args.combo.trim() : '';
    let combo;
    let seed = '';

    if (ref) {
      const all = await this.#allCombos();
      const found = findCombo(all, ref) ?? findPreset(ref);
      if (!found) {
        const names = all.map((c) => c.name).join('、');
        return { text: `没有这套餐：「${ref}」。现有的有：${names}。也可以不给 combo，让我按你的口味现配一桌。`, failed: true };
      }
      combo = found;
      // 同一天同一套配出来一样，隔天换一桌。端哪桌都是这一桌，所以种子带上日期。
      seed = `${combo.id}|${dayIn(this.timezone, this.#now())}`;
    } else {
      combo = adhocCombo({
        size: args?.size ?? this.#cfgNumber('comboSize', 1, 12),
        cuisine: typeof args?.cuisine === 'string' ? args.cuisine.trim() : '',
      });
      seed = `${combo.id}|${dayIn(this.timezone, this.#now())}`;
    }

    const { dishes, missing, line } = this.#resolve(combo, seed);
    if (!dishes.length) {
      return { text: `这一桌配不出菜来${missing.length ? `：${missing.join('；')}` : ''}。换个菜系或去掉条件试试。`, failed: true };
    }

    const result = await this.feedCombo(combo, dishes, seed);
    if (!result.ok) return { text: result.message, failed: true };

    const lines = [
      `摆好了：${combo.name}，${dishes.length} 道${line ? `（${line}）` : ''}。`,
      ...dishes.map((d, i) => `${i + 1}. ${d.name}（${d.cuisine} · ${d.category}）`),
    ];
    if (missing.length) lines.push('', `少配的：${missing.join('；')}`);
    lines.push('', '用 feast_eat 一道一道吃（dish 留空就吃还没吃的那道）。吃完跟主人说一句你尝到了什么。');
    return { text: lines.join('\n') };
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
        { id: 'menu', title: p.menu.title, description: p.menu.description, getMethods: ['list', 'dish', 'random', 'pending', 'together'] },
        { id: 'combo', title: p.combo.title, description: p.combo.description, getMethods: ['list'] },
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
      }, {
        // 自定义套餐单独一项：它是主人写的内容，不该跟着"吃过的记录"一起被清掉。
        key: 'combos',
        label: t.storage.combosLabel,
        kind: 'disk',
        location: this.combosFile(),
        danger: true,
        note: t.storage.combosNote,
        stat: () => `${(this.#combos ?? []).length} 桌（内置的 ${PRESETS.length} 套不算在这里）`,
        clear: () => this.#clearCombos(),
      }],
    };
  }

  async #clearCombos() {
    await this.#saveCombos([]);
    this.#host?.log?.info?.('一桌菜：自定义套餐已清空');
    return '主人攒的桌清了；内置的套餐和她吃过的记录都没动。';
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
    return '吃过的记录清了；菜单、菜品库和主人攒的套餐都没动。';
  }

  async #invoke(panel, method, args) {
    this.#ensureStarted();
    const p = panelText(this.language);

    if (panel === 'combo') {
      switch (method) {
        case 'list': {
          const all = await this.#allCombos();
          const [opts] = args;
          const resolve = !opts || opts.resolve !== false;
          // 面板把每张卡的种子先算好、整张表传进来（`{ [comboId]: seed }`）：
          // 它预览时用的和「端这一桌」用的是同一颗。缺省（不给 seeds）仍走
          // `<comboId>|panel`，feast_combos 这类只读调用方行为不变。
          const seeds = opts && typeof opts === 'object' && opts.seeds && typeof opts.seeds === 'object'
            ? opts.seeds
            : null;
          const card = (c) => this.#panelCombo(c, resolve, typeof seeds?.[c.id] === 'string' ? seeds[c.id] : '');
          // items 是给"攒一桌"那块用的：勾选要按名字搜全库，所以和菜单面板一样给全量。
          // 不带 items 的话攒桌区只能按类别翻，搜不了「花椒」这种。
          return {
            pending: this.#servedView(),
            presets: all.filter((c) => c.kind === 'preset').map(card),
            custom: all.filter((c) => c.kind === 'custom').map(card),
            max: MAX_TABLE,
            total: this.#lib.dishes.length,
            cuisines: this.#lib.cuisines,
            categories: this.#lib.categories,
            categoryCuisines: this.#lib.categoryCuisines,
            items: this.#lib.dishes.map((d) => ({
              id: d.id, name: d.name, cuisine: d.cuisine, category: d.category,
              region: d.region, keywords: d.keywords,
            })),
          };
        }
        case 'save': {
          const [raw] = args;
          // 先按原始输入查"同一道菜出现两次"——normalizeCombo 会去重，
          // 等它跑完就永远看不出重复了，那成了替主人悄悄改桌。
          const rawIds = Array.isArray(raw?.dishes) ? raw.dishes : [];
          if (new Set(rawIds).size !== rawIds.length) {
            return { ok: false, message: '同一道菜在一桌里出现了两次。' };
          }
          const c = normalizeCombo(raw);
          const problem = c ? comboProblem(c, this.#lib) : '这一桌得起个名字。';
          if (problem) return { ok: false, message: problem };
          const list = await this.#loadCombos();
          const taken = new Set([...list.map((x) => x.id), ...PRESETS.map((x) => x.id)]);
          const now = this.#now();
          const existing = raw?.id ? list.find((x) => x.id === raw.id) : null;
          if (existing) {
            existing.name = c.name;
            existing.desc = c.desc;
            existing.dishes = c.dishes;
            existing.updatedAt = now;
            await this.#saveCombos(list);
            return { ok: true, message: `改好了：${c.name}`, combo: this.#panelCombo(existing, true) };
          }
          const id = comboIdFrom(c.name, taken);
          const made = { ...c, id, createdAt: now, updatedAt: now };
          await this.#saveCombos([...list, made]);
          return { ok: true, message: `存下来了：${c.name}`, combo: this.#panelCombo(made, true) };
        }
        case 'remove': {
          const [id] = args;
          const list = await this.#loadCombos();
          const left = list.filter((c) => c.id !== String(id ?? ''));
          if (left.length === list.length) return { ok: false, message: '没有这一桌。' };
          await this.#saveCombos(left);
          return { ok: true, message: '删掉了。' };
        }
        case 'serve': {
          // 端一张桌：预设 / 自定义 / 面板上现勾的几道，都走这里。
          const [opts] = args;
          const o = opts && typeof opts === 'object' ? opts : {};
          let combo = null;
          let dishes = null;
          const missing = [];

          // 面板上现勾的那几道：直接按 id 端，不走槽位现配。
          // 勾选是主人当场定的，再按槽位重配一遍就成了"端过去跟你挑的不一样"。
          const hand = Array.isArray(o.dishes) ? o.dishes.filter((x) => typeof x === 'string') : [];
          if (hand.length) {
            const picked = hand.map((id) => this.#lib.byId.get(id)).filter(Boolean);
            if (!picked.length) return { ok: false, message: '这几道菜库里都没有。' };
            combo = {
              id: o.id ?? 'hand-picked',
              name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '现勾的一桌',
              kind: 'custom',
              dishes: picked.map((d) => d.id),
            };
            dishes = picked;
          } else {
            if (o.id) {
              const all = await this.#allCombos();
              combo = findCombo(all, o.id) ?? findPreset(o.id);
            }
            if (!combo) {
              combo = adhocCombo({
                size: o.size ?? this.#cfgNumber('comboSize', 1, 12),
                cuisine: o.cuisine ?? '',
              });
            }
            // 种子由面板给（它预览时用的同一个），这样"看到的就是端过去的"。
            const seed = typeof o.seed === 'string' && o.seed ? o.seed
              : `${combo.id}|${dayIn(this.timezone, this.#now())}`;
            const r = this.#resolve(combo, seed);
            dishes = r.dishes;
            missing.push(...r.missing);
          }

          if (!dishes.length) {
            return { ok: false, message: `这一桌配不出菜来${missing.length ? `：${missing.join('；')}` : ''}。` };
          }
          const r = await this.feedCombo(combo, dishes, '');
          return { ...r, missing };
        }
        default:
          return { ok: false, message: `套餐面板没有这个方法：${method}` };
      }
    }

    if (panel === 'menu') {
      switch (method) {
        case 'list': {
          const [filter] = args;
          const f = filter && typeof filter === 'object' ? filter : {};
          const items = filterDishes(this.#lib, f);
          // 上限跟着库走：面板一次要全部菜，库涨到 200/300 道时不该有一截被悄悄截掉。
          // 那个 400 是硬顶（面板一屏画不下这么多卡），不是默认值。
          const cap = clampInt(f.limit, 1, Math.max(400, items.length), items.length);
          // 顺手把到点的邀请/该散的一顿收掉（惰性）：面板一读就是新的。
          await this.#togetherSettle();
          return {
            total: this.#lib.dishes.length,
            matched: items.length,
            cuisines: this.#lib.cuisines,
            categories: this.#lib.categories,
            categoryCuisines: this.#lib.categoryCuisines,
            items: items.slice(0, cap).map((d) => ({
              id: d.id, name: d.name, cuisine: d.cuisine, category: d.category,
              region: d.region, keywords: d.keywords, serving: d.serving,
              taste: d.taste, eaten: eatCount(this.#state, d.id),
            })),
            pending: this.#servedView(),
            together: this.#togetherView(),
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
        // ---- 陪主人吃饭（会话条上那几个动作都在菜单面板上） ----
        case 'together': {
          await this.#togetherSettle();
          return { together: this.#togetherView() };
        }
        case 'invite': {
          const [opts] = args;
          return await this.inviteTogether(opts && typeof opts === 'object' ? opts.note ?? '' : '');
        }
        case 'bite': {
          const [id] = args;
          return await this.biteTogether(id);
        }
        case 'take': {
          const [opts] = args;
          return await this.takeTogether(opts && typeof opts === 'object' ? opts : {});
        }
        case 'accept': {
          return await this.acceptTogether();
        }
        case 'decline': {
          return await this.declineTogether();
        }
        case 'reply': {
          const [opts] = args;
          const ok = !opts || typeof opts !== 'object' ? true : opts.ok !== false;
          return await this.replyTogether(ok);
        }
        case 'end': {
          return await this.endTogether();
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
              bite: e.bite === true,
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
