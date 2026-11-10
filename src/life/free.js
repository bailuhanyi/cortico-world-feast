/**
 * 「她的一天」里的自由时间：到点叫醒她「现在是你自己的时间」，让她自己挑一件事做，
 * 做完用 feast_life_play 记一笔。
 *
 * 从 dsh 那边的 playtime World 并进来，只保留「叫醒 + 记账」两件事。与那边的区别有两条：
 *
 *   1. **菜单是可配置文本**。默认只给通用说法（「出去转转」「找个视频看一会儿」），
 *      不点名任何别的扩展的工具——World 契约不允许一个 World 直接依赖另一个扩展，
 *      认证也会卡这一条。想让她用上具体工具，自己在配置里填。
 *   2. **跟日程交叉**：到点时先看日程里此刻那一段，睡着就不叫（睡觉不该被「你的时间」打扰），
 *      醒着就在正文里说她这会儿本来在做什么，把两条线缝上。
 *
 * 纯函数，不碰文件、不碰定时器、不碰宿主。
 */
import { hmIn } from '../state.js';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** 一天最多记几笔（防脏文件把内存撑爆）。 */
export const PLAY_MAX_DONE = 50;

/**
 * 解析档位：`10:00,14:00` → [{ hm, min }]，去重、排序、丢掉非法项。
 * 中文逗号和空白也认。
 */
export function parseSlots(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? '').split(/[,，\s]+/)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) continue;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) continue;
    const hm = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    if (seen.has(hm)) continue;
    seen.add(hm);
    out.push({ hm, min: h * 60 + mi });
  }
  return out.sort((a, b) => a.min - b.min);
}

/** 空的一天：还没叫过、还没记过。 */
export function newPlay(date) {
  return { date, done: [], fired: {}, pending: null, skipped: false, skippedSlots: {} };
}

/** 不信任盘上的内容。 */
export function cleanPlay(raw, date) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const play = newPlay(date ?? text(src.date, 10));
  if (Array.isArray(src.done)) {
    play.done = src.done
      .filter((d) => d && typeof d === 'object' && text(d.activity, 80))
      .slice(-PLAY_MAX_DONE)
      .map((d) => ({ at: Number(d.at) || 0, activity: text(d.activity, 80), note: text(d.note, 300) }));
  }
  if (src.fired && typeof src.fired === 'object') {
    for (const [k, v] of Object.entries(src.fired)) {
      if (/^\d{2}:\d{2}$/.test(k) || k === '补') play.fired[k] = Number(v) || 0;
    }
  }
  // 到点了但日程说她被占着、所以没叫的那几档。留着是为了在面板上解释「为什么没叫我」。
  if (src.skippedSlots && typeof src.skippedSlots === 'object') {
    for (const [k, v] of Object.entries(src.skippedSlots)) {
      if (!/^\d{2}:\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
      play.skippedSlots[k] = { at: Number(v.at) || 0, doing: text(v.doing, 40) };
    }
  }
  if (src.pending && typeof src.pending === 'object' && text(src.pending.slot, 8)) {
    play.pending = {
      slot: text(src.pending.slot, 8),
      since: Number(src.pending.since) || 0,
      lastNudgeAt: Number(src.pending.lastNudgeAt) || 0,
      retries: Number(src.pending.retries) || 0,
    };
  }
  play.skipped = src.skipped === true;
  return play;
}

/**
 * 今天记了几件、够不够「不再按点叫」的那条线。
 *
 * ⚠ `goal` 是**叫醒的上限，不是任务的额度**：到了这条线只表示「接下来不按点叫你了」，
 * 不表示不许再动。`feast_life_play` 根本不看它——做够了照样能记，记多少都算。
 * 措辞上也别写成「还差 N 件」，那读起来像欠着什么；写成「记了 N 件（到这个数就不按点叫了）」。
 */
export function playProgress(play, goal) {
  const done = play?.done?.length ?? 0;
  const left = goal > 0 ? Math.max(0, goal - done) : null;
  return { done, goal, left, reached: goal > 0 && done >= goal };
}

/**
 * 这一拍该做什么：
 *  - fire  ：到某一档（或今天还一次没叫过，补一档）
 *  - retry ：上一档叫了没记账，到催的时间
 *  - drop  ：这档催完了 / 挂太久，放掉等下一档
 *  - none  ：安静
 *
 * `asleep` 为真时**不 fire**（日程说这会儿在睡觉），但 retry / drop 照常——
 * 已经叫过的那一档要能正常收尾，不然会永远挂着。
 */
export function planFreeTick(play, cfg, { nowMs, nowMin, asleep = false } = {}) {
  if (play.skipped) return { action: 'none' };
  const goal = clampInt(cfg?.lifeFreeGoal, 0, 12, 3);
  const p = playProgress(play, goal);
  // 到线了只是「不再按点叫」；她想做什么随时能做，不受这个数管。
  if (p.reached) return { action: 'none' };

  const retryMin = clampInt(cfg?.lifeFreeRetryMin, 5, 240, 40);
  const maxRetries = clampInt(cfg?.lifeFreeMaxRetries, 0, 5, 1);
  const grace = clampInt(cfg?.lifeFreeGraceMin, 1, 180, 20);

  if (play.pending) {
    const age = Math.max(0, nowMs - play.pending.lastNudgeAt);
    if (age > 2 * 3600_000) return { action: 'drop', reason: '挂太久了' };
    if (maxRetries > 0 && play.pending.retries < maxRetries && age >= retryMin * 60_000) {
      return { action: 'retry', slot: play.pending.slot };
    }
    if (maxRetries === 0 || play.pending.retries >= maxRetries) {
      return { action: 'drop', reason: '这一档催完了' };
    }
    return { action: 'none' };
  }

  if (asleep) return { action: 'none' };

  const slots = parseSlots(cfg?.lifeFreeSlots);
  for (const s of slots) {
    if (!play.fired[s.hm] && nowMin >= s.min && nowMin - s.min <= grace) {
      return { action: 'fire', slot: s.hm };
    }
  }

  // 今天一次都没叫过（应用下午才开）：补一档，别让一整天白过。
  if (slots.length && Object.keys(play.fired).length === 0
    && nowMin >= slots[0].min && nowMin <= slots[slots.length - 1].min + grace) {
    return { action: 'fire', slot: '补' };
  }
  return { action: 'none' };
}

/** 记下这一档已叫（retry 只累加次数）。 */
export function markFreeNudged(play, nowMs, slot, retry = false) {
  if (retry && play.pending) {
    play.pending.retries += 1;
    play.pending.lastNudgeAt = nowMs;
    return;
  }
  play.fired[slot] = nowMs;
  play.pending = { slot, since: nowMs, lastNudgeAt: nowMs, retries: 0 };
}

/** 记一笔做过的事，清掉 pending。 */
export function recordPlay(play, { nowMs, activity, note = '' }) {
  const name = text(activity, 80);
  if (!name) throw Object.assign(new Error('activity 不能为空：写清楚你玩了哪一件'), { status: 400 });
  const entry = { at: nowMs, activity: name, note: text(note, 300) };
  play.done.push(entry);
  if (play.done.length > PLAY_MAX_DONE) play.done = play.done.slice(-PLAY_MAX_DONE);
  play.pending = null;
  return entry;
}

/** 今天不想玩了：剩下的档位不再叫。 */
export function skipFreeToday(play) {
  play.skipped = true;
  play.pending = null;
}

/** 今天做过什么（一行话）。tz 给定时按本地时刻显示。 */
export function freeDoneText(play, tz = 'Asia/Shanghai') {
  if (!play?.done?.length) return '还没';
  return play.done.map((d) => `${hmIn(tz, d.at)} ${d.activity}`).join('；');
}

/** 下一档是几点（给人看）。 */
export function nextFreeSlotText(play, cfg, nowMin) {
  const slots = parseSlots(cfg?.lifeFreeSlots);
  if (!slots.length) return '没排档';
  const goal = clampInt(cfg?.lifeFreeGoal, 0, 12, 3);
  if (playProgress(play, goal).reached) return '今天够了';
  const next = slots.find((s) => !play.fired[s.hm] && s.min > nowMin);
  return next ? next.hm : '今天没有了';
}

/** 状态页/面板一行话。 */
export function freeStatusLine(play, cfg, nowMin) {
  const goal = clampInt(cfg?.lifeFreeGoal, 0, 12, 3);
  const p = playProgress(play, goal);
  const goalText = goal > 0 ? `${p.done}/${goal}` : `${p.done}`;
  const pending = play?.pending ? ` · 在等「${play.pending.slot}」记账` : '';
  return `今天 ${goalText} 件 · 下一档 ${nextFreeSlotText(play, cfg, nowMin)}${pending}`;
}

/**
 * 这一段是不是在睡觉。
 *
 * 0.7.2 补：原来各处的判据都是 `/睡/`，于是「回笼觉」「打盹」「小憩」「补觉」都不算睡——
 * 到她自己的时间那一档会把她从回笼觉里叫起来。这里收成一处，叫醒判断和自由判断都用它。
 */
const ASLEEP_HINTS = /睡|回笼觉|打盹|小憩|眯一会儿|眯一会|补觉|午觉|赖床/;

export function isAsleepActivity(item) {
  const act = typeof item === 'string' ? item : String(item?.activity ?? '');
  return ASLEEP_HINTS.test(act);
}

/**
 * 日程里这一段算不算「她自己的时间」。
 *
 * 0.7.2 改成**排除法**。原来是白名单（自己的时间/自由/在家玩/休息/摸鱼/发呆/躺着/追剧/
 * 玩游戏/看剧），实测在她真实的宅家日上：13 段里只命中 2 段，默认三档里两档被静默跳过——
 * 面板上只剩「今天没有了 / 已记 0 件」，功能像坏的。
 *
 * 白名单判反了会互相打脸（上班时说「这是你的时间」），所以不能整段翻成黑名单；
 * 但把「她分明闲着」的情形漏掉一样是错。折中是：**只排除明确被占用的**。
 * 睡觉、上班、通勤、开会、加班这些一望即知不该叫；其余（刷手机、打游戏、
 * 窗边发呆、收拾屋子、追剧）都算她自己的空档。
 */
const BUSY_HINTS = /睡|回笼觉|打盹|小憩|眯一会儿|眯一会|补觉|午觉|赖床|上班|通勤|开会|加班|赶工|赶稿|赶进度|工作|办公|搬砖|值班|出差|面试|上课|考试|会议|训练|排练/i;

export function isFreeActivity(item) {
  if (!item) return false;
  const act = String(item.activity ?? '');
  if (!act.trim()) return false;
  return !BUSY_HINTS.test(act);
}

/**
 * 到点了，但日程说这会儿在做别的事。
 *
 * 不叫她，也不假装「这是你的时间」；只在日程本身是自由段时才叫。
 * 返回一句给她看的话（说明为什么这次不叫她），或空串。
 */
export function notFreeReason(item) {
  if (!item) return '';
  if (isAsleepActivity(item)) return '';
  return `这会儿你在${item.activity}，不硬塞给你`;
}

/**
 * 叫醒事件的正文。
 *
 * `where` 是日程里此刻那一段，拼进来让「她自己的时间」有落点，而不是跟日程各说各的。
 * `menu` 是可配置文本，原样贴进去。
 * `freeNow` 为真表示日程说这会儿本来就是自由段——只有这时措辞才用「现在是你自己的时间」。
 */
export function freeEventText({
  slot, retry = false, play, cfg = {}, where = '', menu = '', nowHm = '', tz = 'Asia/Shanghai',
  freeNow = true,
} = {}) {
  const goal = clampInt(cfg?.lifeFreeGoal, 0, 12, 3);
  const p = playProgress(play, goal);
  const tag = slot === '补' ? '' : ` · ${slot}`;
  const head = retry
    ? `【食时 · 自己的时间】${slot === '补' ? '刚才那一档' : `${slot} 那档`}你还没记。`
    : (freeNow
      ? `【食时 · 你自己的时间${tag}】现在是你自己的时间，不是主人找你，也不是待办。`
      : `【食时 · 有点空档${tag}】这会儿手头没事，想做什么都可以，不是主人找你，也不是待办。`);

  const lines = [head];
  if (where && !retry) {
    // 日程那一段的名字本身就叫「自己的时间」，拼出「你在自己的时间里」很别扭——这种情况只报地点。
    if (/自己的时间|自由/.test(where)) {
      const place = /（(.+)）/.exec(where)?.[1];
      if (place) {
        lines.push(place === '家'
          ? '你现在在家，随便做点什么都行。'
          : `你现在在${place}，随便做点什么都行。`);
      }
    } else {
      lines.push(freeNow
        ? `你这会儿本来在${where}，正好可以做点自己想做的。`
        : `你现在在${where}，这会儿没什么安排。`);
    }
  }
  lines.push(`今天已经玩过：${freeDoneText(play, tz)}。`);
  if (menu && !retry) {
    lines.push('想做的话，下面这些只是个例子，不照着也行；想到什么就做什么，什么都不做也可以：');
    lines.push(menu);
  }
  const tail = [];
  tail.push('做完随手用 feast_life_play 记一笔（activity 写做了什么，note 一句细节）。不记也没关系，记只是给你自己攒。');
  if (cfg?.lifeFreeAskReport !== false) {
    tail.push('顺手跟主人说一句——一句话就够，不用汇报。');
  }
  tail.push('现在不想动就不用管这条，今天也不催你第二次。');
  lines.push(tail.join(''));
  // 收尾那句也要跟着 freeNow 走：日程说她在通勤时，末句再说「这是你自己的时间」就自相矛盾。
  if (nowHm) {
    lines.push(freeNow
      ? `（现在 ${nowHm}。这是你自己的时间，做不做、做什么都由你，聊到时自然带一句就好。）`
      : `（现在 ${nowHm}。手头这点空档，做不做都由你，聊到时自然带一句就好。）`);
  }
  return lines.join('\n');
}

/** feast_life_play 的回执。 */
export function playDoneText({ entry, play, cfg = {}, nowHm = '' }) {
  const goal = clampInt(cfg?.lifeFreeGoal, 0, 12, 3);
  const p = playProgress(play, goal);
  const lines = [
    `记下了：${nowHm ? `${nowHm} ` : ''}${entry.activity}${entry.note ? `——${entry.note}` : ''}。`,
  ];
  // 别写成「还差 N 件」——那读起来像欠着任务。这里是「叫醒的上限」，不是额度。
  if (p.left === null) {
    lines.push(`今天记了 ${p.done} 件。`);
  } else if (p.left > 0) {
    lines.push(`今天记了 ${p.done} 件。到 ${goal} 件就不按点叫你了；没到也一样，随时想做随时做。`);
  } else {
    lines.push(`今天记了 ${p.done} 件——过了 ${goal} 件就不再按点叫你了。想再动随时动，不用等下一次叫醒，记了照样算。`);
  }
  if (cfg?.lifeFreeAskReport !== false) lines.push('跟主人说一句刚才做了什么——一句话就够，不用汇报。');
  return lines.join('\n');
}
