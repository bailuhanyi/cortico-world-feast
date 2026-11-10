/**
 * 「请 Coo 自己写明天」这一来一回。
 *
 * World 契约不允许直接读 Memory 或调 Persona 的工具，host.cognition? 也不保证存在，
 * 所以不内置模型调用：到点推一条 internal 事件，请她用 feast_life_plan 把 JSON 交回来，
 * World 只做校验、补空档和落盘。她没交回就用 templateDay 兜底。
 */
import { cleanDay } from './store.js';
import { dateLabel } from './time.js';

/** 事件正文：给她的写作要求（她看得到），也是工具参数的格式说明。 */
export function planEventText({ date, type, recent = '', mealSlots = '11:30,18:00', who = {} } = {}) {
  const name = who.name || '她';
  const lines = [
    `【一桌菜 · 她的一天】该想想 ${dateLabel(date)}（${date}）怎么过了。不是主人找你，也不是待办，是你自己的日子。`,
    `这一天按「${type?.name || '普通的一天'}」来：${type?.guide || '照你平常的样子过一天。'}`,
  ];
  if (recent) lines.push(`最近几天：\n${recent}`);
  lines.push(`饭点照旧是 ${mealSlots}，别把这两段排成别的事；吃饭那几段可以写去哪儿吃、和谁一起。`);
  lines.push('想好之后用 feast_life_plan 交回：date 填这一天，dayType 填日型的 id，title 一句话，mood 一句话，items 从 00:00 排到 24:00、不重叠不留空档，每段写 { start, end, activity, location, detail }，想写穿了什么、手边有什么也可以加 outfit / props。');
  lines.push('写的是你自己想做的事，不是任务清单；不必工整，也不用跟主人解释。交回来记好了就行，回一句「想好了」都算多。');
  lines.push(`（${name}临时改主意时用 feast_life_adjust；忘了自己刚才在干嘛用 feast_life_now。）`);
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
