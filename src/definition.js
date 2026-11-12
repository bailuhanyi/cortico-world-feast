/**
 * WorldDefinition：默认配置、实例工厂和自描述。
 * create() 必须保持纯：不读状态文件、不建目录、不启动定时器。
 */
import {
  DEFAULTS, EVENT_FEED, EVENT_LIFE_FREE, EVENT_LIFE_MOMENT, EVENT_LIFE_PLAN, EVENT_MEAL, EVENT_TABLE,
  EVENT_TOGETHER, ID, LABEL,
} from './config.js';
import { FEAST_TOOL_DECLS, FeastWorld } from './world.js';

/** 自描述里每个工具配一句给人看的话，按工具名。 */
const TOOL_SUMMARIES = {
  feast_menu: {
    zh: '看菜单：按菜系/类别/标签筛，或随机给几道今天能吃的。',
    en: 'Browse the library by cuisine, category or tag, or get a few random picks.',
  },
  feast_eat: {
    zh: '吃一道菜：给出味道、香气、口感、余韵和「这一口」当下的样子。',
    en: 'Eat a dish: flavour, aroma, texture, aftertaste, plus how it lands right now.',
  },
  feast_taste: {
    zh: '只看不吃：查一道菜的完整味道档案。',
    en: 'Read a dish\'s full flavour profile without eating it.',
  },
  feast_history: {
    zh: '吃过什么、吃过几回，以及攒出来的口味画像。',
    en: 'What she has eaten, how often, and the accumulated taste profile.',
  },
  feast_reaction: {
    zh: '记一句吃完的真实反应（合口味 / 一般 / 不太对付）。',
    en: 'Log how a dish actually landed.',
  },
  feast_skip: {
    zh: '今天不想吃：跳过剩下的饭点。',
    en: 'Skip the rest of today\'s meals.',
  },
  feast_combos: {
    zh: '看有哪些套餐（一桌菜），每套现配出具体菜名。',
    en: 'See the set meals available, each resolved into actual dishes.',
  },
  feast_combo: {
    zh: '开一桌：把一个套餐配成具体几道菜摆上来，一道一道吃。',
    en: 'Set a whole table: resolve a set meal into dishes and serve them together.',
  },
  feast_together: {
    zh: '陪主人一起吃：问他要不要一起、分他一口、这顿先收了。',
    en: 'Eat together: ask the owner to share a meal, offer him a bite, or close the meal.',
  },
  feast_life_now: {
    zh: '查她此刻在做什么、待会儿想做什么、今天早些时候做过什么。',
    en: 'What she is doing right now, what she wants to do next, and what she did earlier today.',
  },
  feast_life_view: {
    zh: '看今天 / 明天 / 某一天她给自己写下的打算。',
    en: 'Read the day she wrote for herself: today, tomorrow, or any past date.',
  },
  feast_life_plan: {
    zh: '把明天（或某一天）的打算交回来记下；收到「该想想明天」的事件时用它。',
    en: 'Hand back the day she just wrote for herself, after the nightly "think about tomorrow" event.',
  },
  feast_life_adjust: {
    zh: '临时改主意：用新的一段盖掉这一天的某个时间区间。',
    en: 'Change her mind: cover a stretch of the day with something else.',
  },
  feast_life_play: {
    zh: '记一笔自己刚做完的事（自己的时间）：记了才知道今天做了几件。',
    en: 'Log something she just did on her own time, so the day adds up.',
  },
  feast_life_skip: {
    zh: '今天不想玩了：跳过剩下的「自己的时间」，今天不再按时叫（随时能自己动）。',
    en: 'Skip the rest of today\'s own-time wake-ups; she can still do anything on her own.',
  },
  feast_life_start: {
    zh: '不用等叫醒：现在就想干点什么时，用它拿一份例子和记账办法。',
    en: 'Start without waiting for a wake-up: hands her example ideas and how to log it.',
  },
};

function describeTools(decls) {
  return decls.map(({ name, description, parameters, tags }) => ({
    name,
    description,
    parameters,
    tags,
    summary: TOOL_SUMMARIES[name],
  }));
}

export const feastDefinition = {
  id: ID,
  label: LABEL,
  /** `worlds.feast` 段的默认值；启用与否由部署决定，定义里恒为 false。 */
  defaults: () => structuredClone(DEFAULTS),
  preflight: () => {
    if (typeof structuredClone !== 'function') throw new Error('食时需要 Node 22+ 的 structuredClone。');
  },
  create: (ctx) => new FeastWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    timezone: ctx.timezone,
    // 补齐配置段用：宿主的 /api/config 读的是落盘的 worlds.feast（不做默认值合并），
    // 段里缺键时界面上会显示成 false / 空 / 0，和实际生效值对不上。
    // 详见 FeastWorld#ensureConfigSection。
    persist: typeof ctx.persist === 'function' ? (patch) => ctx.persist(patch) : null,
  }),
  /** 自描述：可能出现的全部工具与事件，不进提示词。 */
  describe: {
    tools: describeTools(FEAST_TOOL_DECLS),
    events: [
      {
        type: EVENT_MEAL,
        description: {
          zh: '到饭点（或上一顿没吃，到催的时间）：正文列出今天吃过什么和几道候选，让她自己挑一道吃。origin 是 internal，按她自己的作息投递，不是主人发的消息。在配置里可以整个关掉。',
          en: 'A meal slot came due (or the previous meal was not eaten): lists what she ate today and a few candidates. Internal origin: her own schedule, not a message from the owner. Can be switched off entirely in config.',
        },
        trigger: 'flush',
      },
      {
        type: EVENT_FEED,
        description: {
          zh: '主人在 WebUI 面板上点「端给她」，把一道菜放到她面前。正文含这道菜上桌的样子和闻到的味道，请她用 feast_eat 尝。origin 是 internal，来自已认证的操作员通道。',
          en: 'The owner served a dish from the WebUI panel. The text describes how it arrives and smells, and asks her to eat it with feast_eat. Internal origin, from the authenticated operator channel.',
        },
        trigger: 'flush',
      },
      {
        type: EVENT_TABLE,
        description: {
          zh: '主人端来一整桌（几道菜，不是一道）：正文列出这一桌有哪几道、合起来是什么口味，请她用 feast_eat 一道一道吃。和 feast.feed 分开是因为正文要说清「几道、还剩哪几道」。origin 是 internal，来自已认证的操作员通道。',
          en: 'The owner served a whole table (several dishes, not one): the text lists them, describes the combined flavour, and asks her to eat through them one by one. Separate from feast.feed because the wording is about a table and its remaining dishes. Internal origin, from the authenticated operator channel.',
        },
        trigger: 'flush',
      },
      {
        type: EVENT_TOGETHER,
        description: {
          zh: '「陪主人吃饭」这条通道，只有主人 → 她这一个方向（她开口邀请主人没有通道，只能面板挂一条 + 她自己说）。meta.kind 分清是哪一件事：invite（主人问要不要一起吃，或他应了她的邀请）、bite（主人喂她一口，正文带这一口当下的样子）、owner-ate（主人自己也在吃什么：库内那道给菜名，自由文本会明说库里没有这道）、back（他接住或没要她分过去的那口）、end（散桌：吃完了 / 主人说散了 / 到点收摊）。origin 是 internal，来自已认证的操作员通道。',
          en: 'The shared-meal channel, owner to her only (she has no way to message the owner; her invitation just hangs on the panel and she says it herself). meta.kind tells the moments apart: invite (the owner asks, or accepts her invitation), bite (the owner feeds her one bite, the text carries how it lands), owner-ate (what the owner is eating himself: a library dish by name, or free text that says outright the library has no such dish), back (he took, or declined, the bite she offered), end (the meal closed: finished / he called it / it timed out). Internal origin, from the authenticated operator channel.',
        },
        trigger: 'flush',
      },
      {
        type: EVENT_LIFE_PLAN,
        description: {
          zh: '每晚到点请她自己写明天怎么过：正文给出日期、日型、最近几天和饭点，请她用 feast_life_plan 交回一份从 00:00 到 24:00 的 JSON。origin 是 internal，是她自己的日子，不是主人交代的事；在配置里可以整个关掉。先落占位再推，不会重复叫。',
          en: 'Nightly ask for the day she wants to have tomorrow: date, day type, recent days and meal slots, then she replies with feast_life_plan and a 00:00–24:00 JSON. Internal origin — her own day, not a task from the owner. Can be switched off entirely in config; a placeholder prevents duplicate asks.',
        },
        trigger: 'flush',
      },
      {
        type: EVENT_LIFE_MOMENT,
        description: {
          zh: '她换了一件事做（时段切换）：一句很轻的「这会儿在…」，用来补上系统前缀没法实时刷新的「此刻」。debounce 搭车投递，不打断、睡觉时段不推；origin 是 internal。在配置里可以关掉。',
          en: 'She moved on to something else: one light line about what she is doing now, covering what the system prefix cannot refresh live. Debounced, never interrupts, never sent while asleep. Internal origin; can be switched off in config.',
        },
        trigger: 'debounce',
      },
      {
        type: EVENT_LIFE_FREE,
        description: {
          zh: '到她自己的时间：一条 internal 事件叫醒她「现在是你自己的时间」，正文带上日程里此刻那一段和一份可配置的菜单，让她挑一件事做，做完用 feast_life_play 记一笔。日程说这会儿在睡觉或正在上班时**不推**（不把「现在是你的时间」硬塞给一个正在上班的人）。没记就催一次，催完放掉；origin 是 internal。',
          en: 'Her own time: an internal event telling her this stretch is hers, with the schedule item she is currently in plus a configurable menu, asking her to pick something and log it with feast_life_play. Never sent while the schedule says she is asleep or busy at work — telling a working person "this time is yours" would contradict the schedule. One retry, then dropped. Internal origin.',
        },
        trigger: 'flush',
      },
    ],
  },
};

export default feastDefinition;
