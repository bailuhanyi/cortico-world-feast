/**
 * 「请 Coo 自己写明天」这一来一回。
 *
 * World 契约不允许直接读 Memory 或调 Persona 的工具，host.cognition? 也不保证存在，
 * 所以不内置模型调用：到点推一条 internal 事件，请她用 feast_life_plan 把 JSON 交回来，
 * World 只做校验、补空档和落盘。她没交回就用 templateDay 兜底。
 */
import { cleanDay } from './store.js';
import { dateLabel } from './time.js';
import { doingsLines } from './doings.js';
import { storyPlanHint } from './storylink.js';

/**
 * 事件正文：给她的写作要求（她看得到），也是工具参数的格式说明。
 *
 * `wardrobe` 是 wardrobeText(lib) 的结果：库非空时在这里列出衣柜/场景/道具和穿搭习惯，
 * 让她写日程时 outfit / scene / props 用库里的正名，生图工作室那边解析才稳。
 * 库读不到就是空串，这段就省掉（不强指不存在的东西）。
 *
 * `doings` 是 doingsFor(parseDoings(cfg.lifeDoings), type) 的结果：主人按日型备的
 * 「能做的事」清单。给了就在这里列出来，让她写出来的每一段是真能做的一件事，
 * 而不是「在家玩」这种空白。没给就是空数组，这段整段不出现（跟以前一样由她自己编）。
 *
 * `rewrite` 是主人从面板点「重写明天」时给的：那一天她已经写好了，这次是**重写**，
 * 措辞和夜里第一次请她写不一样，免得她以为自己从没写过。
 *
 * `mealByHer` 是配置里「饭点由她自己定」开着（0.10.0）：这时饭点那一句换成邀请，
 * 说清她可以在交回时带上 `mealSlots`，而不是告诉她「照旧是 11:30、18:00」。
 */
export function planEventText({
  date, type, recent = '', mealSlots = '11:30,18:00', who = {}, wardrobe = '', doings = [],
  rewrite = false, mealByHer = false, mapOn = false, funOn = false, storyOn = false, noWork = false,
} = {}) {
  const name = who.name || '她';
  const lines = [
    rewrite
      ? `【鱼的每一天 · 她的一天】重新想想 ${dateLabel(date)}（${date}）：这是你自己的日子，不是待办。`
      : `【鱼的每一天 · 她的一天】想想 ${dateLabel(date)}（${date}）怎么过：这是你自己的日子，不是待办。`,
    `这一天按「${type?.name || '普通的一天'}」来：${type?.guide || '照你平常的样子过一天。'}`,
  ];
  if (noWork) lines.push('主人已持续关闭工作排程：上班日、加班日、摸鱼日的权重为 0。不要安排上班、加班或工作通勤；work 写 false。此规则持续到主人重新开启，不能用单日决定绕过。');
  if (rewrite) {
    lines.push('（之前那一版已经收了；不想改就用 feast_life_view 看一眼再照着交回一遍，改主意也完全可以。）');
  }
  // 主人备的「能做的事」：紧跟在日型后面，让她写每一段时手边有具体的事可选。
  lines.push(...doingsLines(doings));
  if (storyOn) lines.push(storyPlanHint());
  if (!storyOn && (mapOn || funOn)) {
    lines.push('如果想安排外出，且当前会话确实提供相应工具，交回日程前可按需查地点（启用配置不等于工具权限，也不证明新地点或故事接口可用）：');
    if (mapOn) lines.push('- 附近散步、去常去的地方或回家：用 map_places 找登记地点，需要详情时用 map_look，location 用地图正名。');
    if (funOn) lines.push('- 想安排一趟娱乐出游：用 fun_places 查场所和可逛项目，按计划时段参考营业时间，location 写实际打算去的场所正名，activity / detail 写想做的事。现在只做计划，到了那天真要出发时再用 fun_go。');
    if (mapOn && funOn) lines.push('- 如果 map_look 提到娱乐时间里相近的场所，先用 fun_places 核对。选定去哪儿，location 就写哪一处的正名。');
    lines.push('没有相应工具、没有合适地点或想在家休息，就保留弹性安排。这里只写计划，不开始故事、不移动当前位置，也不登记实际经历。');
  }
  if (recent) lines.push(`最近几天：\n${recent}`);
  if (wardrobe) lines.push(wardrobe);
  lines.push(mealByHer
    ? `几点吃由你定：交回时带上 mealSlots（HH:MM，1–4 档，例如 ["12:10","19:00"]），那一天就按你定的叫；不写就用默认的 ${mealSlots}。吃饭那几段可以写去哪儿吃、和谁一起。`
    : `饭点照旧是 ${mealSlots}，别把这两段排成别的事；吃饭那几段可以写去哪儿吃、和谁一起。`);
  lines.push('想好后用 feast_life_plan 交回：date、dayType、title、mood 和从 00:00 连到 24:00 的 items；每段写 start/end/activity/location/detail，可加 outfit/props/scene/category（sleep/work/commute/meal/personal），不确定分类就省略。');
  lines.push('这是想法，不是任务或完成证明；交回后不用解释。');
  lines.push('（改主意用 feast_life_adjust；忘了此刻用 feast_life_now。想发图时沿用其中的穿着和地点。）');
  if (mealByHer) lines.push('（上不上班、几点吃这两件事，白天想改就说一句，用 feast_life_day——不用重写一整天。）');
  return lines.join('\n');
}

/**
 * 校验她交回的内容。宽松但要能用：至少两段、有活动名，
 * normalizeItems 负责修重叠和补空档，日期由 World 指定、不信任她填的。
 */
export function normalizePlan(raw, date, opts = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || raw.items.length < 2) {
    throw new Error('至少要写两段（start / end / activity），从早到晚把这一天排满。');
  }
  const named = raw.items.filter((it) => it && typeof it === 'object' && String(it.activity ?? '').trim());
  if (named.length < 2) throw new Error('每段都要写清楚在做什么（activity）。');
  return cleanDay({ ...raw, date, source: 'coo', by: 'coo', generatedAt: Date.now() }, date, opts);
}
/** 面板/事件里给 Coo 看的 items 示例，别让她猜格式。 */
export const PLAN_ITEM_EXAMPLE = '{ "start": "09:30", "end": "12:00", "activity": "在家收拾屋子", "location": "家", "detail": "把窗台那几盆花挪出去晒晒" }';
