/**
 * 食时的配置段与文案。
 *
 * 段名是 `config.json` 的 `worlds.feast`。WebUI 热改就地写这个对象，
 * World 每次用时现读，所以这里只有默认值与 schema，不持有副本。
 */

export const ID = 'feast';
export const LABEL = '食时';

/** 饭点提醒用的事件类型；也是 describe 里对外的名字。 */
export const EVENT_MEAL = 'feast.meal';
/** 主人端了一道菜过来。 */
export const EVENT_FEED = 'feast.feed';
/** 0.6.0：主人端了一桌菜过来（几道，不是一道）。 */
export const EVENT_TABLE = 'feast.table';
/** 0.6.0：「陪主人吃饭」的一切——邀请、喂一口、主人自己吃了什么、回喂的回应、散桌。 */
export const EVENT_TOGETHER = 'feast.together';
/** 0.7.0：「她的一天」——每晚请她自己写明天。 */
export const EVENT_LIFE_PLAN = 'feast.life.plan';
/** 0.7.0：时段切换时搭车补一句「这会儿在做什么」。 */
export const EVENT_LIFE_MOMENT = 'feast.life.moment';
/** 0.7.0：到她自己的时间——叫醒她，让她挑一件事做。 */
export const EVENT_LIFE_FREE = 'feast.life.free';

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

  // ---- 「她的一天」（0.7.0 融合自 dsh-daily-schedule）----
  /** 总开关。关掉后不生成、不注入、不推时段事件；食时的饭点照旧。 */
  lifeEnabled: true,
  /** 每晚几点请她自己写明天（24 小时制 HH:MM）。 */
  lifeGenerateAt: '22:00',
  /** 此刻文本与时段事件的时间精度：minute / halfhour / block。 */
  lifePrecision: 'halfhour',
  /** 「待会儿想做」列几件。 */
  lifeUpcoming: 3,
  /** 傍晚几点之后，环境提示词里附上明天的打算。 */
  lifeTomorrowAfter: '18:00',
  /** 时段切换时搭车推一条轻量事件（debounce，不打断）。 */
  lifeMomentEvents: true,
  /** 强制日型（id 或名字）；留空按星期加权随机。 */
  lifeDayType: '',
  /** 要不要附上「怎么把这些带进聊天」那段说话方式。 */
  lifeVoiceOn: true,
  /** 一天最多几段（Coo 交回时也按这个上限裁）。 */
  lifeMaxItems: 24,
  /** 允许她自己改「今天已经过完」的时段（默认不允许：那是事实，不是计划）。 */
  lifeAdjustPast: false,
  // ---- 自由时间（0.7.0 从 playtime World 并进来）----
  /** 自由时间总开关。0.7.2 补：之前代码里认这个键但配置表没声明，等于只能手改 config.json。 */
  lifeFreeEnabled: true,
  /** 她自己的时间：几点叫醒她。留空 = 不叫（但工具和面板还在）。 */
  lifeFreeSlots: '10:00,14:00,21:00',
  /** 到几条就不再**按点叫**（不是任务额度：到了照样能记、能继续做）。0 = 只叫不计数。 */
  lifeFreeGoal: 3,
  /** 到点后多少分钟内还算这一档（应用刚启动的容错）。 */
  lifeFreeGraceMin: 20,
  /** 叫醒后没记账，隔多少分钟催一次。 */
  lifeFreeRetryMin: 40,
  /** 一档最多催几次；0 = 不催。 */
  lifeFreeMaxRetries: 1,
  /** 叫醒时贴给她的例子，原样进事件；默认只给通用说法，不点名别的扩展的工具。 */
  lifeFreeMenu: [
    '- 出去转转，走一小段路，看看外面现在什么样',
    '- 找点想看的东西看一会儿（视频、番、随便什么都行）',
    '- 发一条自己的动态，写一两句今天的心情',
    '- 就在家待着，听点东西、发会儿呆',
  ].join('\n'),
  /** 做完要不要提醒她跟主人说一句。 */
  lifeFreeAskReport: true,
  // ---- 生图工作室联动（0.7.1）----
  /** 联动总开关：扫素材库、列给 Coo、自动补 outfit、注入指向句。关掉=纯文本日程，不碰库。 */
  lifeWardrobeOn: true,
  /** 素材库目录；留空 = 用默认路径 <数据目录>/imggen-library（和生图工作室默认一致）。 */
  lifeWardrobeDir: '',
  /** 自动补 outfit：模型没填时按「情境穿搭 > 情境默认 > 延续上一段 > 场景默认 > 默认服饰」补。关掉只列库不补。 */
  lifeWardrobeAutoOutfit: true,
});

const ZH = {
  label: '食时',
  lamp: '食时',
  stopped: '未启动',
  badgeToday: '今天',
  badgeNext: '下一顿',
  prompt: '食时 World 的环境说明：这里有一张会端菜的桌子，也有她自己过的一天。主人可以端一道菜过来，她也能自己挑；每道菜都有味道档案，吃完可以记一句自己的反应。她的一天由她自己写，写在饭点之外的那些时段里。',
  /** 配置卡片标题：0.7.2 把原来一张 35 项的巨卡拆成 5 张。 */
  groups: {
    meal: '饭点',
    together: '一起吃饭',
    life: '她的一天',
    free: '她自己的时间',
    wardrobe: '生图联动',
  },
  config: {
    title: '食时',
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
    lifeEnabled: '她的一天',
    lifeEnabledDesc: '总开关。关掉后不再生成日程、不再往系统提示里放她的日子，也不推时段事件；食时的饭点照旧。',
    lifeGenerateAt: '请她写明天的时间',
    lifeGenerateAtDesc: '每晚几点推一条事件，请她自己写明天怎么过。她交回之前先放一个占位，不会重复叫；她没写就第二天用模板兜底。',
    lifePrecision: '时间精度',
    lifePrecisionDesc: '她查「此刻在干嘛」时说的是精确时刻、约到半小时，还是只说这一阵。只影响工具和事件，不进系统前缀。',
    lifeUpcoming: '待会儿列几件',
    lifeUpcomingDesc: '「她待会儿想做」最多列几件，也用于时段事件里那句轻轻的预告。',
    lifeTomorrowAfter: '几点之后提明天',
    lifeTomorrowAfterDesc: '傍晚过了这个点，环境提示词里会附上明天的打算。一天只变一次，不会打穿前缀缓存。',
    lifeMomentEvents: '换事情时补一句',
    lifeMomentEventsDesc: '时段切换时搭车推一条很轻的事件（debounce，不打断、睡觉时不推），补上系统前缀没法实时更新的「此刻」。',
    lifeDayType: '固定日型',
    lifeDayTypeDesc: '留空 = 按工作日/周末加权挑一种；填 id 或名字（workday / restday / outing / homebody / overtime / slacking）就固定用它。',
    lifeVoiceOn: '带上说话方式',
    lifeVoiceOnDesc: '附上「怎么把这些带进聊天」：别把日子说成任务清单、别报时间段、别提「日程」。',
    lifeMaxItems: '一天最多几段',
    lifeMaxItemsDesc: '她自己写明天时的段数上限；写多了按时间顺序裁掉后面的，再补齐 00:00–24:00。',
    lifeAdjustPast: '允许她改过去',
    lifeAdjustPastDesc: '默认关着：今天已经过完的时段她不能改——日程是计划，过去的应该是事实，回头篡改就等于编自己做过什么。打开后她也能改今天早上的安排（主人从面板改不受这个开关限制）。',
    lifeFreeEnabled: '她自己的时间',
    lifeFreeEnabledDesc: '自由时间总开关。关掉后不再按点叫醒她，工具和面板照旧可用（想自己开始随时能开始）。',
    lifeFreeSlots: '几点的档',
    lifeFreeSlotsDesc: '24 小时制 HH:MM，逗号分隔。到点叫醒她一次「现在是你自己的时间，做点自己想做的」；日程说这会儿在睡觉就不叫。留空 = 不叫（工具和面板照样能用）。',
    lifeFreeGoal: '记到几件就不再叫',
    lifeFreeGoalDesc: '注意这是**叫醒的上限，不是任务额度**：记到这个数只表示「今天不再按点叫你了」，不表示不许再动——她想做什么随时能做，记多少都算数。0 = 只叫不计数（会一直叫到晚上，不推荐）。',
    lifeFreeGraceMin: '档位容错',
    lifeFreeGraceMinDesc: '到点后多少分钟内还算这一档；应用刚启动或短暂卡顿时不至于直接跳过。',
    lifeFreeRetryMin: '没记就催',
    lifeFreeRetryMinDesc: '叫醒后没记账，隔多少分钟再催一次。',
    lifeFreeMaxRetries: '最多催几次',
    lifeFreeMaxRetriesDesc: '一档催完还没记就放掉，等下一档；0 = 不催。',
    lifeFreeMenu: '叫醒时给的例子',
    lifeFreeMenuDesc: '原样贴进叫醒事件里，措辞上明确写着「这些只是例子，不照着也行」。默认只写通用说法（不点名别的扩展的工具——World 不该依赖别的扩展）。想让她真用上某个工具，在这里写明，例如「去花语乡转转（bloom_inbox peek）」。改完下一档生效。',
    lifeFreeAskReport: '做完说一声',
    lifeFreeAskReportDesc: '开启时，叫醒和记账回执都会提醒她「跟主人说一句你刚才玩了什么」。',
    lifeWardrobeOn: '生图联动',
    lifeWardrobeOnDesc: '扫生图工作室的素材库（<数据目录>/imggen-library），写日程时列出衣柜/场景/道具和穿搭习惯，模型没填 outfit 时按习惯自动补，并在提示词里加一句指向生图工作室。关掉=纯文本日程，不碰库、不联动。库读不到时自动静默降级，不影响她的一天。',
    lifeWardrobeDir: '素材库目录',
    lifeWardrobeDirDesc: '生图工作室的素材库根目录；留空时自动读 imggen 的 libraryRoot（用户在 imggen 那边改了库目录，这边自动跟上），读不到再降级到 <数据目录>/imggen-library。手动填这里只用于 imggen 没配 libraryRoot 又想指定路径的情况。',
    lifeWardrobeAutoOutfit: '自动补穿着',
    lifeWardrobeAutoOutfitDesc: '模型没写 outfit 时按这个顺序补：情境穿搭（睡前→睡衣这种她自己配的）> 情境默认（内置常识表，库里找得到才用）> 延续上一段（睡觉那段不延续、不硬猜）> 场景默认 > 她的默认服饰。关掉=只列库不补，写成什么就是什么。',
  },
  storage: {
    label: '吃过的记录',
    note: '清掉之后她不记得吃过什么、口味画像也会重来，正在一起吃的这一顿也会收摊（喂过的口、主人吃的那份都清了）。菜品库和主人攒的套餐都不受影响。',
    combosLabel: '主人攒的套餐',
    combosNote: '这是主人自己攒的桌。清掉之后套餐面板只剩内置的那几套；她吃过的记录不受影响。',
    lifeLabel: '她的一天',
    lifeNote: '清掉之后今天和往期的日程、她写过的标题和心情都会重来；吃过的记录、口味画像和主人攒的套餐都不受影响。',
  },
};

const EN = {
  // 显示名跟着 package.json 的 en displayName 走（0.7.2 改名：一桌菜 → 食时 / Mealtime）。
  // 只改中文会把英文面板标题留在旧名字上，和市场里那一页对不上。
  label: 'Mealtime',
  lamp: 'Mealtime',
  stopped: 'not running',
  badgeToday: 'Today',
  badgeNext: 'Next meal',
  prompt: 'The Mealtime world: a day of her own, and a table that serves food. The owner can put a dish down, she can also pick one herself; every dish carries a full flavour profile, and she can log how it landed. She writes her own day, in the hours between meals.',
  groups: {
    meal: 'Meals',
    together: 'Eating together',
    life: 'Her day',
    free: 'Her own time',
    wardrobe: 'Image-gen link',
  },
  config: {
    title: 'Mealtime',
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
    lifeEnabled: 'Her day',
    lifeEnabledDesc: 'Master switch. Off: no generation, no day in the system prefix, no moment events. Meal reminders are unaffected.',
    lifeGenerateAt: 'When to ask for tomorrow',
    lifeGenerateAtDesc: 'The nightly event asking her to write tomorrow herself. A placeholder prevents repeat asks; if she never replies, a template fills the day.',
    lifePrecision: 'Time precision',
    lifePrecisionDesc: 'How precise "right now" is in tools and events: exact minute, half hour, or just the block. Never enters the system prefix.',
    lifeUpcoming: 'Upcoming items',
    lifeUpcomingDesc: 'How many things "she wants to do next" lists, also used in the light moment events.',
    lifeTomorrowAfter: 'Mention tomorrow after',
    lifeTomorrowAfterDesc: 'After this hour the environment note adds tomorrow. Changes once a day, so the prefix cache stays intact.',
    lifeMomentEvents: 'Nudge on a switch',
    lifeMomentEventsDesc: 'A very light debounced event when her current activity changes (never while asleep), covering what the system prefix cannot refresh live.',
    lifeDayType: 'Fixed day type',
    lifeDayTypeDesc: 'Blank = weighted pick by weekday/weekend. Set an id or name to always use that type.',
    lifeVoiceOn: 'Include the voice note',
    lifeVoiceOnDesc: 'Adds "how to bring this into chat": never a task list, never clock times, never the word schedule.',
    lifeMaxItems: 'Max items per day',
    lifeMaxItemsDesc: 'Upper bound when she writes a day; extra items are dropped and 00:00–24:00 is filled in.',
    lifeAdjustPast: 'Let her edit the past',
    lifeAdjustPastDesc: 'Off by default: hours of today that are already over cannot be changed by her. The schedule is a plan; the past should be what happened. Turning this on lets her edit this morning too (edits you make from the panel are never restricted).',
    lifeFreeEnabled: 'Her own time',
    lifeFreeEnabledDesc: 'Master switch for her own time. Off: no scheduled wake-ups; the tools and the panel still work (she can always start something herself).',
    lifeFreeSlots: 'Wake-up slots',
    lifeFreeSlotsDesc: '24-hour HH:MM, comma separated. She is woken once per slot and told this is her own time; skipped while the schedule says she is asleep. Blank = never wake her (tools and panel still work).',
    lifeFreeGoal: 'Stop calling after',
    lifeFreeGoalDesc: 'This is a cap on wake-ups, **not a quota**: reaching it only means she is not woken on schedule any more — she may still do things whenever she likes, and anything she logs still counts. 0 = wake but never count (not recommended).',
    lifeFreeGraceMin: 'Slot grace',
    lifeFreeGraceMinDesc: 'How many minutes after a slot still count as that slot; keeps a restart from skipping it.',
    lifeFreeRetryMin: 'Retry after',
    lifeFreeRetryMinDesc: 'If she has not logged anything, wait this many minutes before nudging again.',
    lifeFreeMaxRetries: 'Max retries',
    lifeFreeMaxRetriesDesc: 'Give up on a slot after this many nudges; 0 = never retry.',
    lifeFreeMenu: 'Example ideas',
    lifeFreeMenuDesc: 'Pasted verbatim into the wake-up event, worded so it is clear these are only examples. Defaults stay generic on purpose — a World must not depend on another extension. To point her at a specific tool, name it here, e.g. "go for a walk (bloom_inbox peek)".',
    lifeFreeAskReport: 'Tell the owner',
    lifeFreeAskReportDesc: 'When on, both the wake-up and the logging receipt remind her to say one sentence about what she just did.',
    lifeWardrobeOn: 'Image-gen link',
    lifeWardrobeOnDesc: 'Scans the image-gen studio library (<dataDir>/imggen-library), lists wardrobe/scene/props and outfit habits when she writes her day, auto-fills outfit from habits when the model leaves it blank, and adds one line in the prompt pointing at the studio. Off = plain-text schedule, no library, no link. Degrades silently when the library is missing; her day is never affected.',
    lifeWardrobeDir: 'Library root',
    lifeWardrobeDirDesc: 'Root of the image-gen studio library; blank = auto-follow imggen libraryRoot (if the user changed it in imggen, this follows), then fall back to <dataDir>/imggen-library. Set this manually only when imggen has no libraryRoot and you need a specific path.',
    lifeWardrobeAutoOutfit: 'Auto-fill outfit',
    lifeWardrobeAutoOutfitDesc: 'When the model omits outfit, fill it in this order: context habit (bedtime→pyjamas, the habits she wrote) > situation default (built-in common sense, only when the wardrobe has that outfit) > carry the previous slot (never carried into sleep, never guessed there) > scene default > her default outfit. Off = list the library but do not fill; whatever she wrote stays.',
  },
  storage: {
    label: 'Eating history',
    note: 'Clearing this erases what she has eaten and the taste profile, and closes any shared meal in progress (the bites and your own food go too). The dish library and your saved set meals are untouched.',
    combosLabel: 'Your saved set meals',
    combosNote: 'Set meals you put together yourself. Clearing this leaves only the built-in sets; her eating history is untouched.',
    lifeLabel: 'Her day',
    lifeNote: 'Clearing this erases today and all past days, including titles and moods she wrote. Eating history, taste profile and your saved set meals are untouched.',
  },
};

export function text(language = 'zh') {
  return language === 'en' ? EN : ZH;
}

/** 全部配置项；路径必须落在 `worlds.feast.` 段内。怎么分卡片见 CONFIG_GROUPS。 */
function configProperties(language = 'zh') {
  const t = text(language).config;
  const K = `worlds.${ID}`;
  return {
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
        [`${K}.lifeEnabled`]: {
          type: 'boolean',
          title: t.lifeEnabled,
          description: t.lifeEnabledDesc,
          'x-hot': true,
        },
        [`${K}.lifeGenerateAt`]: {
          type: 'string',
          title: t.lifeGenerateAt,
          description: t.lifeGenerateAtDesc,
          'x-hot': true,
        },
        [`${K}.lifePrecision`]: {
          type: 'string',
          title: t.lifePrecision,
          description: t.lifePrecisionDesc,
          enum: ['minute', 'halfhour', 'block'],
          'x-hot': true,
        },
        [`${K}.lifeUpcoming`]: {
          type: 'integer',
          title: t.lifeUpcoming,
          description: t.lifeUpcomingDesc,
          minimum: 0,
          maximum: 6,
          'x-hot': true,
        },
        [`${K}.lifeTomorrowAfter`]: {
          type: 'string',
          title: t.lifeTomorrowAfter,
          description: t.lifeTomorrowAfterDesc,
          'x-hot': true,
        },
        [`${K}.lifeMomentEvents`]: {
          type: 'boolean',
          title: t.lifeMomentEvents,
          description: t.lifeMomentEventsDesc,
          'x-hot': true,
        },
        [`${K}.lifeDayType`]: {
          type: 'string',
          title: t.lifeDayType,
          description: t.lifeDayTypeDesc,
          'x-hot': true,
        },
        [`${K}.lifeVoiceOn`]: {
          type: 'boolean',
          title: t.lifeVoiceOn,
          description: t.lifeVoiceOnDesc,
          'x-hot': true,
        },
        [`${K}.lifeMaxItems`]: {
          type: 'integer',
          title: t.lifeMaxItems,
          description: t.lifeMaxItemsDesc,
          minimum: 8,
          maximum: 40,
          'x-hot': true,
        },
        [`${K}.lifeAdjustPast`]: {
          type: 'boolean',
          title: t.lifeAdjustPast,
          description: t.lifeAdjustPastDesc,
          'x-hot': true,
        },
        [`${K}.lifeFreeEnabled`]: {
          type: 'boolean',
          title: t.lifeFreeEnabled,
          description: t.lifeFreeEnabledDesc,
          'x-hot': true,
        },
        [`${K}.lifeFreeSlots`]: {
          type: 'string',
          title: t.lifeFreeSlots,
          description: t.lifeFreeSlotsDesc,
          'x-hot': true,
        },
        [`${K}.lifeFreeGoal`]: {
          type: 'integer',
          title: t.lifeFreeGoal,
          description: t.lifeFreeGoalDesc,
          minimum: 0,
          maximum: 12,
          'x-suffix': ' 件',
          'x-hot': true,
        },
        [`${K}.lifeFreeGraceMin`]: {
          type: 'integer',
          title: t.lifeFreeGraceMin,
          description: t.lifeFreeGraceMinDesc,
          minimum: 1,
          maximum: 180,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
        [`${K}.lifeFreeRetryMin`]: {
          type: 'integer',
          title: t.lifeFreeRetryMin,
          description: t.lifeFreeRetryMinDesc,
          minimum: 5,
          maximum: 240,
          'x-suffix': ' 分钟',
          'x-hot': true,
        },
        [`${K}.lifeFreeMaxRetries`]: {
          type: 'integer',
          title: t.lifeFreeMaxRetries,
          description: t.lifeFreeMaxRetriesDesc,
          minimum: 0,
          maximum: 5,
          'x-hot': true,
        },
        [`${K}.lifeFreeMenu`]: {
          type: 'string',
          title: t.lifeFreeMenu,
          description: t.lifeFreeMenuDesc,
          'x-multiline': true,
          'x-hot': true,
        },
        [`${K}.lifeFreeAskReport`]: {
          type: 'boolean',
          title: t.lifeFreeAskReport,
          description: t.lifeFreeAskReportDesc,
          'x-hot': true,
        },
        [`${K}.lifeWardrobeOn`]: {
          type: 'boolean',
          title: t.lifeWardrobeOn,
          description: t.lifeWardrobeOnDesc,
          'x-hot': true,
        },
        [`${K}.lifeWardrobeDir`]: {
          type: 'string',
          title: t.lifeWardrobeDir,
          description: t.lifeWardrobeDirDesc,
          // 手打 Windows 路径太容易错；宿主认 x-path，给个原生选目录。
          'x-path': { kind: 'directory' },
          'x-hot': true,
        },
        [`${K}.lifeWardrobeAutoOutfit`]: {
          type: 'boolean',
          title: t.lifeWardrobeAutoOutfit,
          description: t.lifeWardrobeAutoOutfitDesc,
          'x-hot': true,
        },
  };
}

/**
 * 配置怎么分成几张卡。
 *
 * 0.7.1 及以前是一张 35 项、说明合计 1700 多字的巨卡，找「穿什么」要滚很久。
 * 宿主支持一个 World 交多组（`cortico-world-desktop-pet` 就交了三组），
 * 这里按**主人脑子里的事**切：吃饭 / 一起吃饭 / 她的一天 / 她自己的时间 / 生图联动。
 * 组 id 后缀固定、不随语言变，配置键不变——拆卡不动任何一项的存储位置。
 */
export const CONFIG_GROUPS = Object.freeze([
  {
    key: 'meal',
    pick: (k) => k === 'mealReminder' || k === 'mealSlots' || k === 'mealGraceMin'
      || k === 'mealRetryMin' || k === 'mealMaxRetries' || k === 'tickSec'
      || k === 'askReaction' || k === 'dislikeChance' || k === 'avoidRepeat'
      || k === 'ownerFeedTTL' || k === 'menuSize',
  },
  {
    key: 'together',
    pick: (k) => k === 'togetherInviteMin' || k === 'togetherMaxInvites'
      || k === 'togetherTTLMin' || k === 'comboSize',
  },
  {
    key: 'life',
    pick: (k) => k.startsWith('life') && !k.startsWith('lifeFree') && !k.startsWith('lifeWardrobe'),
  },
  {
    key: 'free',
    pick: (k) => k.startsWith('lifeFree'),
  },
  {
    key: 'wardrobe',
    pick: (k) => k.startsWith('lifeWardrobe'),
  },
]);

/**
 * WebUI 的配置组。返回**数组**：一份 5 张卡。
 *
 * 每一项仍然只声明一次（键就是 `worlds.feast.<key>`），拆的是卡片不是配置——
 * 所以老 config.json 不用迁移，配置表里变红的风险只在于「某一项被漏进任何一张卡」，
 * 那由 test/world.test.mjs 的「每项都得在某张卡里」钉住。
 */
export function configGroups(language = 'zh') {
  const t = text(language);
  const props = configProperties(language);
  const K = `worlds.${ID}`;
  const out = [];
  const used = new Set();
  for (const g of CONFIG_GROUPS) {
    const properties = {};
    for (const [path, prop] of Object.entries(props)) {
      const key = path.slice(K.length + 1);
      if (!g.pick(key)) continue;
      properties[path] = prop;
      used.add(path);
    }
    if (!Object.keys(properties).length) continue;
    out.push({
      // 第一张沿用老 id（`world:feast`），别的加后缀：宿主按 id 认领，改第一张的 id 会让老书签失效。
      id: out.length === 0 ? `world:${ID}` : `world:${ID}:${g.key}`,
      owner: `world:${ID}`,
      schema: { type: 'object', title: t.groups[g.key], properties },
    });
  }
  // 保险：万一哪天加了新键却忘了归类，宁可多一张「其他」也不让配置项凭空消失。
  const rest = Object.fromEntries(Object.entries(props).filter(([p]) => !used.has(p)));
  if (Object.keys(rest).length) {
    out.push({
      id: `world:${ID}:more`,
      owner: `world:${ID}`,
      schema: { type: 'object', title: t.groups.more ?? '其他', properties: rest },
    });
  }
  return out;
}

/** 兼容老调用方：只要第一组。新代码用 configGroups()。 */
export function configGroup(language = 'zh') {
  return configGroups(language)[0];
}

/** 面板文案。客户端产物不 import 服务端模块，所以面板自己的文案在 dist/webui.js 里另有一份。 */
export function panelText(language = 'zh') {
  if (language === 'en') {
    return {
      menu: { title: 'Menu', description: 'Browse dishes, read a full flavour profile, put one on her table, or share a meal with her.' },
      combo: { title: 'Set meals', description: 'Serve a whole table: a ready-made set, or pick a few dishes and save your own.' },
      history: { title: 'What she ate', description: 'What she has eaten, and the taste profile that has accumulated.' },
      today: { title: 'Today', description: 'The day she wrote for herself, the hours around her meals, and the days before.' },
    };
  }
  return {
    menu: { title: '菜单', description: '翻菜品、看完整的味道档案，端起一道放到她面前，或者和她一起吃一顿。' },
    combo: { title: '套餐', description: '一桌一桌地端：现成的套餐，或者勾几道自己攒一桌存下来。' },
    history: { title: '吃过什么', description: '她吃过的东西，以及攒出来的口味画像。' },
    today: { title: '今天', description: '她自己写下的这一天：饭点之外的那些时段，还有往期。' },
  };
}
