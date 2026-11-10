/**
 * 「她的一天」：把日程变成给模型看的文字。
 *
 * 三层，各管各的时机（这是融合版最关键的取舍）：
 *   · envBlock()  —— 只放一天变一两次的东西（今天什么日子、全天打算、傍晚后的明天），
 *                    进 ENV_PROMPT.md 的 {{feast_life_block}}。Coo 只在前缀重建时重算
 *                    envPromptVars()，所以这里绝不写「此刻几点 / 正在做什么」。
 *   · nowText()   —— 精确到时段的「此刻」，给 feast_life_now 工具用（主动查询）。
 *   · momentLine()—— 时段切换时搭车推的一条轻量事件（被动变化），不重复整段说话方式。
 *
 * 所有进系统前缀的文本都过 safe()：内容里万一出现 {{...}} 不能被当成模板变量。
 */
import { findItem } from './schedule.js';
import { clock, dateLabel, parseClock, zonedNow } from './time.js';
import { TOOL_LINE, priorityLine, voiceText } from './voice.js';

const safe = (s) => String(s).replace(/\{\{/g, '{').replace(/\}\}/g, '}');
const isSleep = (it) => /睡/.test(it.activity);

function timeLabel(precision, minute) {
  if (precision === 'minute') return clock(minute);
  if (precision === 'halfhour') return `约 ${clock(Math.floor(minute / 30) * 30)}`;
  return '';
}

const placeOf = (it) => (it.scene || it.location ? `（${it.scene || it.location}）` : '');

/** 环境提示词里那一整段；关掉「她的一天」时返回空字符串。 */
export function envBlock({ today, tomorrow = null, cfg = {}, tz = 'Asia/Shanghai', nowMs = Date.now(), who = {}, wardrobe = '' } = {}) {
  if (cfg.lifeEnabled === false) return '';
  const z = zonedNow(tz, nowMs);
  const lines = [
    '## 她的一天',
    '（这是你自己过日子的背景，别在回复里提到这段说明本身，更别把它当成任务清单。）',
    `今天是 ${dateLabel(z.date)}（${tz}）。`,
  ];
  if (today && Array.isArray(today.items) && today.items.length) {
    lines.push(`今天：${today.dayType?.name || '普通的一天'}${today.title ? `——${today.title}` : ''}${today.mood ? `（心情：${today.mood}）` : ''}`);
    const main = today.items.filter((it) => !isSleep(it)).slice(0, 12).map((it) => it.activity).join(' → ');
    if (main) lines.push(`今天的打算：${main}。`);
    // 做决定的时刻就在这一行旁边：说清这是她自己早上写的、可以变，比只在工具提示里写一句管用。
    lines.push('（这是你早上给自己写的，不是任务，随时可以变——想改成别的就用 feast_life_adjust 盖掉那一段，不想做了就把 activity 留空，改完直接说决定本身。）');
    const after = parseClock(cfg.lifeTomorrowAfter ?? '18:00');
    if (after !== null && z.minute >= after && tomorrow && Array.isArray(tomorrow.items) && tomorrow.items.length) {
      const tmain = tomorrow.items.filter((it) => !isSleep(it)).slice(0, 6).map((it) => it.activity).join('、');
      lines.push(`明天（${dateLabel(tomorrow.date)}，${tomorrow.dayType?.name || ''}）你打算：${tomorrow.title || ''}${tmain ? `。想做的事：${tmain}` : ''}`);
    }
  } else {
    lines.push('你今天过得怎样还没想好，按常理推断此刻在做什么。');
  }
  const voice = voiceText(cfg, who);
  if (voice) lines.push(voice);
  // 生图联动指向句：库非空才加（wardrobeHintLine 的结果），进前缀（一天变一两次级别，不变）。
  if (wardrobe) lines.push(wardrobe);
  lines.push(priorityLine(who.name));
  lines.push(TOOL_LINE);
  return safe(lines.join('\n'));
}

/** feast_life_now 的回执：此刻在做什么、待会儿想做什么、早些时候做过什么。 */
export function nowText({ today, cfg = {}, tz = 'Asia/Shanghai', nowMs = Date.now(), who = {} } = {}) {
  const z = zonedNow(tz, nowMs);
  const lines = ['# 她此刻的生活（背景，别在回复里提到这段说明本身）'];
  const t = timeLabel(cfg.lifePrecision ?? 'halfhour', z.minute);
  lines.push(`现在：${dateLabel(z.date)}${t ? ` ${t}` : ''}（${tz}）`);
  if (!today || !Array.isArray(today.items) || !today.items.length) {
    lines.push('她今天过得怎样还没想好，按常理推断她此刻在做什么。');
  } else {
    lines.push(`今天：${today.dayType?.name || '普通的一天'}${today.title ? `——${today.title}` : ''}${today.mood ? `（心情：${today.mood}）` : ''}`);
    const i = findItem(today, z.minute);
    const cur = today.items[i];
    if (cur) {
      lines.push(`她正在：${cur.activity}${placeOf(cur)}，从 ${cur.start} 到 ${cur.end} 左右${cur.detail ? `——${cur.detail}` : ''}`);
      const extra = [
        cur.outfit ? `身上穿着${cur.outfit}` : '',
        cur.props && cur.props.length ? `手边有${cur.props.join('、')}` : '',
        cur.with && cur.with.length ? `和${cur.with.join('、')}在一起` : '',
      ].filter(Boolean);
      if (extra.length) lines.push(`她${extra.join('，')}。`);
      if (isSleep(cur)) lines.push('她这会儿睡着了，被叫醒的话会迷迷糊糊、想接着睡，回复短、带着困意。');
    }
    const upcoming = Math.max(0, Math.min(6, Number(cfg.lifeUpcoming) || 3));
    const next = today.items.slice(i + 1, i + 1 + upcoming);
    if (next.length) lines.push(`她待会儿想做：${next.map((it) => `${it.start} ${it.activity}${placeOf(it)}`).join('；')}`);
    const past = today.items.slice(0, Math.max(0, i)).filter((it) => !isSleep(it)).slice(-5);
    if (past.length) lines.push(`她今天早些时候：${past.map((it) => it.activity).join(' → ')}`);
  }
  // 这里**不再附 voiceText / priorityLine / TOOL_LINE**：那三段都已经在系统前缀的
  // {{feast_life_block}} 里了，工具回执再贴一遍纯属重复——实测这一下把回执从 508
  // token 降到约 110。她只要能看到这个回执，就一定能看到那段前缀（日期/日程都靠它），
  // 所以不存在「回执有了、前缀没有」的情况。
  return safe(lines.join('\n'));
}

/** 时段切换时搭车推的一句，不重复整段提示词。 */
export function momentLine({ today, cfg = {}, tz = 'Asia/Shanghai', nowMs = Date.now() } = {}) {
  if (!today || !Array.isArray(today.items) || !today.items.length) return '';
  const z = zonedNow(tz, nowMs);
  const i = findItem(today, z.minute);
  const cur = today.items[i];
  if (!cur || isSleep(cur)) return '';
  const t = timeLabel(cfg.lifePrecision ?? 'halfhour', z.minute);
  const upcoming = Math.max(0, Math.min(3, Number(cfg.lifeUpcoming) || 3));
  const next = today.items.slice(i + 1, i + 1 + upcoming).map((it) => it.activity).join('、');
  const head = `【一桌菜 · 她的一天】${t ? `${t}，` : ''}你这会儿在${cur.activity}${placeOf(cur)}`;
  const tail = next ? `；待会儿想${next}` : '';
  return safe(`${head}${tail}。（这是你自己的日子，不用特意跟主人汇报，聊到时自然带一句就好。）`);
}

/** 时段标识：跨段就变，用来避免同一段里反复推事件。 */
export function segmentKey({ today, tz = 'Asia/Shanghai', nowMs = Date.now() } = {}) {
  const z = zonedNow(tz, nowMs);
  if (!today || !Array.isArray(today.items) || !today.items.length) return `${z.date}|none`;
  const i = findItem(today, z.minute);
  return `${z.date}|${i}|${today.items[i]?.start ?? ''}`;
}

/** 全天时间线：feast_life_view 的回执文本。 */
export function dayText(day) {
  if (!day) return '这一天还没有日程。';
  if (!day.items?.length) return `${dateLabel(day.date)}：她还没想好这一天怎么过。`;
  const lines = [`${dateLabel(day.date)} · ${day.dayType?.name || ''}${day.title ? ` · ${day.title}` : ''}${day.mood ? `（心情：${day.mood}）` : ''}`];
  for (const it of day.items) {
    const tags = [
      it.situation ? `情境：${it.situation}` : '',
      it.outfit ? `穿着：${it.outfit}` : '',
      it.props?.length ? `物品：${it.props.join('、')}` : '',
      it.with?.length ? `和：${it.with.join('、')}` : '',
    ].filter(Boolean);
    lines.push(`- ${it.start}–${it.end} ${it.activity}${placeOf(it)}${it.detail ? `：${it.detail}` : ''}${tags.length ? ` [${tags.join('；')}]` : ''}`);
  }
  if (day.changes?.length) lines.push(`临时改过 ${day.changes.length} 次主意：${day.changes.slice(-3).map((c) => c.note).join('；')}`);
  lines.push('（这是她自己记着的打算。跟人说起时用自己的话挑着说，别提「日程」「计划」，也别报时间段。）');
  return safe(lines.join('\n'));
}
