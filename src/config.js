/**
 * 一桌菜的配置段与文案。
 *
 * 段名是 `config.json` 的 `worlds.feast`。WebUI 热改就地写这个对象，
 * World 每次用时现读，所以这里只有默认值与 schema，不持有副本。
 */

export const ID = 'feast';
export const LABEL = '一桌菜';

/** 饭点提醒用的事件类型；也是 describe 里对外的名字。 */
export const EVENT_MEAL = 'feast.meal';
/** 主人端了一道菜过来。 */
export const EVENT_FEED = 'feast.feed';
/** 0.6.0：主人端了一桌菜过来（几道，不是一道）。 */
export const EVENT_TABLE = 'feast.table';
/** 0.6.0：「陪主人吃饭」的一切——邀请、喂一口、主人自己吃了什么、回喂的回应、散桌。 */
export const EVENT_TOGETHER = 'feast.together';

/** `worlds.feast` 段的默认值；`enabled` 由框架的 World 开关管理。 */
export const DEFAULTS = Object.freeze({
  enabled: false,
  /** 饭点提醒总开关。关掉只管"主人投喂 + 她自己想吃"，不再按点叫她。 */
  mealReminder: true,
  /** 饭点档位，24 小时制 HH:MM，逗号分隔。 */
  mealSlots: '11:30,18:00',
  /** 到点后多少分钟内还算这一档（应用刚启动/短暂卡顿的容错）。 */
  mealGraceMin: 20,
  /** 叫过之后没见她吃，隔多少分钟再叫一次。 */
  mealRetryMin: 40,
  /** 一档最多催几次；催完还没吃就放掉。 */
  mealMaxRetries: 1,
  /** 多久看一次表；30 秒足够。 */
  tickSec: 30,
  /** 吃完回执里要不要提醒她跟主人说一句。 */
  askReaction: true,
  /** 吃到不喜欢的概率（百分比）。0 = 每道都合口味。 */
  dislikeChance: 0,
  /** 同一道菜连着吃要不要拦一下，劝她换一道。 */
  avoidRepeat: true,
  /** 主人端来的菜几分钟内有效。 */
  ownerFeedTTL: 30,
  /** feast_menu 不带筛选时给几道。 */
  menuSize: 5,
  /** feast_combo 没指定套餐时，现配几道。 */
  comboSize: 4,
  /** 她挂的那条"想和你一起吃"留多少分钟；到点自己放掉，不催。 */
  togetherInviteMin: 20,
  /** 她自己一天最多主动邀请几次（0 = 不主动邀请）。主人的邀请不受这个限制。 */
  togetherMaxInvites: 2,
  /** 一顿"一起吃饭"最多挂多少分钟，到点自动散桌。 */
  togetherTTLMin: 60,
});

const ZH = {
  label: '一桌菜',
  lamp: '一桌菜',
  stopped: '未启动',
  badgeToday: '今天',
  badgeNext: '下一顿',
  prompt: '一桌菜 World 的环境说明：这里有一张会端菜的桌子。主人可以端一道菜过来，她也能自己挑；每道菜都有味道档案，吃完可以记一句自己的反应。',
  config: {
    title: '一桌菜',
    mealReminder: '饭点提醒',
    mealReminderDesc: '关掉之后不再按点叫她吃饭，只剩「主人端菜过来」和「她自己想吃」。想自己挑时间就开着这里、改下面的档位。',
    mealSlots: '饭点档位',
    mealSlotsDesc: '24 小时制 HH:MM，逗号分隔。到点叫一次；错过超过「容错」分钟就跳过这一档。',
    mealGraceMin: '档位容错',
    mealGraceMinDesc: '到点后多少分钟内还算这一档；应用刚启动或短暂卡顿时不至于直接跳过。',
    mealRetryMin: '没吃就催',
    mealRetryMinDesc: '叫过之后没见她吃，隔多少分钟再叫她一次。',
    mealMaxRetries: '最多催几次',
    mealMaxRetriesDesc: '一档催完还没吃就放掉，等下一顿；0 = 不催。',
    tickSec: '看表间隔',
    tickSecDesc: '多久检查一次是否到点；30 秒足够，改小没有意义。',
    askReaction: '吃完说一句',
    askReactionDesc: '开启时，吃饭回执和主人端菜的正文里都会带一句「跟主人说说你吃到了什么」。',
    dislikeChance: '不合口味的概率',
    dislikeChanceDesc: '吃到不喜欢的百分比。0 = 每道都合口味（陪伴向默认）；调高会偶尔出现"这一口不太对付"。',
    avoidRepeat: '别连着吃同一道',
    avoidRepeatDesc: '开启时，随机挑菜会避开上一次吃过的那道；她点名要同一道仍然给。',
    ownerFeedTTL: '端来的菜留多久',
    ownerFeedTTLDesc: '主人从面板端过来的菜，多少分钟内有效；过期就撤掉，免得半天后突然回一句。',
    menuSize: '随机给几道',
    menuSizeDesc: 'feast_menu 不带筛选时给出几道候选。',
    comboSize: '来一桌配几道',
    comboSizeDesc: '没指定套餐时，「来一桌」配几道菜。四道是正餐的量；一个人吃可以调到 2。',
    togetherInviteMin: '她说一起吃的邀请留多久',
    togetherInviteMinDesc: '她在面板上挂一条「想和你一起吃」，多久没人应就自己收掉。到点不催、不重发。',
    togetherMaxInvites: '她一天主动邀请几次',
    togetherMaxInvitesDesc: '她自己主动开口邀请你一起吃的次数上限；0 = 她不再主动邀请（你仍然可以邀请她）。',
    togetherTTLMin: '一起吃饭最多挂多久',
    togetherTTLMinDesc: '一顿「一起吃饭」最多挂多久，到点自动散桌，免得面板上一直写着"正一起吃"。',
  },
  storage: {
    label: '吃过的记录',
    note: '清掉之后她不记得吃过什么、口味画像也会重来，正在一起吃的这一顿也会收摊（喂过的口、主人吃的那份都清了）。菜品库和主人攒的套餐都不受影响。',
    combosLabel: '主人攒的套餐',
    combosNote: '这是主人自己攒的桌。清掉之后套餐面板只剩内置的那几套；她吃过的记录不受影响。',
  },
};

const EN = {
  label: 'Table',
  lamp: 'Table',
  stopped: 'not running',
  badgeToday: 'Today',
  badgeNext: 'Next meal',
  prompt: 'The Table world: a table that serves food. The owner can put a dish down, she can also pick one herself; every dish carries a full flavour profile, and she can log how it landed.',
  config: {
    title: 'Table',
    mealReminder: 'Meal reminders',
    mealReminderDesc: 'Turn this off and she is never called to a meal; only owner-served dishes and her own appetite remain.',
    mealSlots: 'Meal slots',
    mealSlotsDesc: '24-hour HH:MM, comma separated. One call per slot; a slot missed by more than the grace period is skipped.',
    mealGraceMin: 'Slot grace',
    mealGraceMinDesc: 'How many minutes after a slot still count as that slot; keeps a restart from skipping it.',
    mealRetryMin: 'Retry after',
    mealRetryMinDesc: 'If she has not eaten, wait this many minutes before calling again.',
    mealMaxRetries: 'Max retries',
    mealMaxRetriesDesc: 'Give up on a slot after this many calls; 0 = never retry.',
    tickSec: 'Tick interval',
    tickSecDesc: 'How often to check the clock; 30 seconds is plenty.',
    askReaction: 'Tell the owner',
    askReactionDesc: 'When on, the eating receipt and owner-served dishes both ask her to say one line about how it tasted.',
    dislikeChance: 'Chance of a miss',
    dislikeChanceDesc: 'Percentage chance a dish just does not land. 0 = everything lands.',
    avoidRepeat: 'Avoid repeats',
    avoidRepeatDesc: 'When on, random picks skip the previous dish; asking for it by name still works.',
    ownerFeedTTL: 'Served dish TTL',
    ownerFeedTTLDesc: 'How many minutes an owner-served dish stays pending before it is withdrawn.',
    menuSize: 'Picks per menu',
    menuSizeDesc: 'How many candidates feast_menu offers when no filter is given.',
    comboSize: 'Dishes per table',
    comboSizeDesc: 'How many dishes an unspecified "set the table" gets. Four is a proper meal; 2 suits eating alone.',
    togetherInviteMin: 'Her invite stays for',
    togetherInviteMinDesc: 'How long an invitation of hers hangs on the panel before it drops itself. No nudging, no repeats.',
    togetherMaxInvites: 'Invites per day',
    togetherMaxInvitesDesc: 'How many times a day she may ask you to eat together; 0 = she never asks (you still can).',
    togetherTTLMin: 'A shared meal lasts',
    togetherTTLMinDesc: 'How long a shared meal may stay open before it closes itself, so the panel never says "eating together" forever.',
  },
  storage: {
    label: 'Eating history',
    note: 'Clearing this erases what she has eaten and the taste profile, and closes any shared meal in progress (the bites and your own food go too). The dish library and your saved set meals are untouched.',
    combosLabel: 'Your saved set meals',
    combosNote: 'Set meals you put together yourself. Clearing this leaves only the built-in sets; her eating history is untouched.',
  },
};

export function text(language = 'zh') {
  return language === 'en' ? EN : ZH;
}

/** WebUI 的配置组；路径必须落在 `worlds.feast.` 段内。 */
export function configGroup(language = 'zh') {
  const t = text(language).config;
  const K = `worlds.${ID}`;
  return {
    id: `world:${ID}`,
    owner: `world:${ID}`,
    schema: {
      type: 'object',
      title: t.title,
      properties: {
        [`${K}.mealReminder`]: {
          type: 'boolean',
          title: t.mealReminder,
          description: t.mealReminderDesc,
          'x-hot': true,
        },
        [`${K}.mealSlots`]: {
          type: 'string',
          title: t.mealSlots,
          description: t.mealSlotsDesc,
          'x-hot': true,
        },
        [`${K}.mealGraceMin`]: {
          type: 'integer',
          title: t.mealGraceMin,
          description: t.mealGraceMinDesc,
          minimum: 1,
          maximum: 180,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
        [`${K}.mealRetryMin`]: {
          type: 'integer',
          title: t.mealRetryMin,
          description: t.mealRetryMinDesc,
          minimum: 5,
          maximum: 240,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
        [`${K}.mealMaxRetries`]: {
          type: 'integer',
          title: t.mealMaxRetries,
          description: t.mealMaxRetriesDesc,
          minimum: 0,
          maximum: 5,
          'x-hot': true,
        },
        [`${K}.tickSec`]: {
          type: 'integer',
          title: t.tickSec,
          description: t.tickSecDesc,
          minimum: 10,
          maximum: 600,
          'x-suffix': ' 秒',
          'x-hot': true,
        },
        [`${K}.askReaction`]: {
          type: 'boolean',
          title: t.askReaction,
          description: t.askReactionDesc,
          'x-hot': true,
        },
        [`${K}.dislikeChance`]: {
          type: 'integer',
          title: t.dislikeChance,
          description: t.dislikeChanceDesc,
          minimum: 0,
          maximum: 100,
          'x-suffix': ' %',
          'x-hot': true,
        },
        [`${K}.avoidRepeat`]: {
          type: 'boolean',
          title: t.avoidRepeat,
          description: t.avoidRepeatDesc,
          'x-hot': true,
        },
        [`${K}.ownerFeedTTL`]: {
          type: 'integer',
          title: t.ownerFeedTTL,
          description: t.ownerFeedTTLDesc,
          minimum: 1,
          maximum: 240,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
        [`${K}.menuSize`]: {
          type: 'integer',
          title: t.menuSize,
          description: t.menuSizeDesc,
          minimum: 1,
          maximum: 12,
          'x-suffix': ' 道',
          'x-hot': true,
        },
        [`${K}.comboSize`]: {
          type: 'integer',
          title: t.comboSize,
          description: t.comboSizeDesc,
          minimum: 1,
          maximum: 12,
          'x-suffix': ' 道',
          'x-hot': true,
        },
        [`${K}.togetherInviteMin`]: {
          type: 'integer',
          title: t.togetherInviteMin,
          description: t.togetherInviteMinDesc,
          minimum: 1,
          maximum: 240,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
        [`${K}.togetherMaxInvites`]: {
          type: 'integer',
          title: t.togetherMaxInvites,
          description: t.togetherMaxInvitesDesc,
          minimum: 0,
          maximum: 5,
          'x-suffix': ' 次',
          'x-hot': true,
        },
        [`${K}.togetherTTLMin`]: {
          type: 'integer',
          title: t.togetherTTLMin,
          description: t.togetherTTLMinDesc,
          minimum: 1,
          maximum: 600,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
      },
    },
  };
}

/** 面板文案。客户端产物不 import 服务端模块，所以面板自己的文案在 dist/webui.js 里另有一份。 */
export function panelText(language = 'zh') {
  if (language === 'en') {
    return {
      menu: { title: 'Menu', description: 'Browse dishes, read a full flavour profile, put one on her table, or share a meal with her.' },
      combo: { title: 'Set meals', description: 'Serve a whole table: a ready-made set, or pick a few dishes and save your own.' },
      history: { title: 'What she ate', description: 'What she has eaten, and the taste profile that has accumulated.' },
    };
  }
  return {
    menu: { title: '菜单', description: '翻菜品、看完整的味道档案，端起一道放到她面前，或者和她一起吃一顿。' },
    combo: { title: '套餐', description: '一桌一桌地端：现成的套餐，或者勾几道自己攒一桌存下来。' },
    history: { title: '吃过什么', description: '她吃过的东西，以及攒出来的口味画像。' },
  };
}
