/**
 * WorldDefinition：默认配置、实例工厂和自描述。
 * create() 必须保持纯：不读状态文件、不建目录、不启动定时器。
 */
import { DEFAULTS, EVENT_FEED, EVENT_MEAL, ID, LABEL } from './config.js';
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
    if (typeof structuredClone !== 'function') throw new Error('一桌菜需要 Node 22+ 的 structuredClone。');
  },
  create: (ctx) => new FeastWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    timezone: ctx.timezone,
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
    ],
  },
};

export default feastDefinition;
