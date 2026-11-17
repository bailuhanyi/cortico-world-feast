/**
 * 「她的一天」里的自由时间：到点说一句话，让她自己挑一件事做，做完用 feast_life_play 记一笔。
 *
 * 从 dsh 那边的 playtime World 并进来，只保留「叫醒 + 记账」两件事。与那边的区别：
 *
 *   1. **菜单是可配置文本**。默认只给通用说法（「出去转转」「找个视频看一会儿」），
 *      不点名任何别的扩展的工具——World 契约不允许一个 World 直接依赖另一个扩展，
 *      认证也会卡这一条。想让她用上具体工具，自己在配置里填。
 *   2. **跟日程交叉，而且说的是那一类该说的话**：到点时先按 classifyItem 看日程里
 *      此刻那一段，睡着就不叫；被占着（上班/通勤/开会）按 lifeFreeBusyCall 决定
 *      「不叫只留痕」还是「叫，但说成报备」；空着才说「现在是你自己的时间」。
 *
 * 0.8.0 起没有配额：**档位就是一天最多叫几次**。不数她记了几件、不催第二遍、不重叫。
 * 那条「记到 N 件就不再叫」的线删掉了，因为它数的是记录、管的是呼叫，越投入越早被掐。
 *
 * 纯函数，不碰文件、不碰定时器、不碰宿主。
 */
import { hmIn } from '../state.js';
import { classifyItem } from './kind.js';

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

/** 空的一天：还没叫过、还没记过、今天没跳过。 */
export function newPlay(date) {
  return { date, done: [], fired: {}, skipped: false, skippedSlots: {} };
}

/**
 * 不信任盘上的内容。
 *
 * 0.7.x 的 play 文件里有 `pending`（挂着的这一档 + 催了几次）。0.8.0 不再催，
 * 读的时候**认它、忽略它**：不迁移、不报错、不因为多一个字段就判脏。
 */
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
  // 到点了但日程说她被占着、所以没叫的那几档（lifeFreeBusyCall 关着时才有）。
  // 留着是为了在面板上解释「为什么这一档没叫我」——那是唯一会出现的沉默了。
  if (src.skippedSlots && typeof src.skippedSlots === 'object') {
    for (const [k, v] of Object.entries(src.skippedSlots)) {
      // '补' 也要能读回来：忙时跳过可能落在「补一档」上，丢了面板就不解释了。
      if ((!/^\d{2}:\d{2}$/.test(k) && k !== '补') || !v || typeof v !== 'object') continue;
      play.skippedSlots[k] = { at: Number(v.at) || 0, doing: text(v.doing, 40) };
    }
  }
  play.skipped = src.skipped === true;
  return play;
}

/**
 * 这一拍该做什么：
 *  - fire  ：到某一档（或今天还一次没处理过，补一档），该说话了
 *  - skip  ：到档了，但日程说她这会儿被占着，而配置说忙时不叫 → 记下这一档、不推事件
 *  - none  ：安静
 *
 * `kind` 是 classifyItem 的结果（'free' | 'busy' | 'asleep' | 'none'）。
 * 睡着时永远不叫，**也不记档**：那一档还在容错窗口里、她醒了就还能叫。
 */
export function planFreeTick(play, cfg, { nowMin = 0, kind = 'free' } = {}) {
  if (play.skipped) return { action: 'none' };
  if (kind === 'asleep') return { action: 'none' };

  const grace = clampInt(cfg?.lifeFreeGraceMin, 1, 180, 20);
  const busyCall = cfg?.lifeFreeBusyCall === true;
  const verdict = (slot) => (kind === 'busy' && !busyCall
    ? { action: 'skip', slot, reason: 'busy' }
    : { action: 'fire', slot, kind });

  const slots = parseSlots(cfg?.lifeFreeSlots);
  // 用「键在不在」而不是真假值：`fired` 里存的是时刻，0 也是合法值，`!fired[hm]` 会把它当成没叫过。
  const pending = slots.filter((slot) => !(slot.hm in play.fired) && nowMin >= slot.min && nowMin - slot.min <= grace);
  const due = pending.at(-1);
  if (due) {
    const plan = verdict(due.hm);
    if (pending.length > 1) plan.mergedSlots = pending.slice(0, -1).map((slot) => slot.hm);
    return plan;
  }

  // 今天一次都没处理过（应用下午才开）：补一档，别让一整天白过。
  if (slots.length && Object.keys(play.fired).length === 0
    && nowMin >= slots[0].min && nowMin <= slots[slots.length - 1].min + grace) {
    return verdict('补');
  }
  return { action: 'none' };
}

/** 记下这一档已经处理过（叫过）。 */
export function markFreeNudged(play, nowMs, slot, mergedSlots = []) {
  for (const handledSlot of [...mergedSlots, slot]) play.fired[handledSlot] = nowMs;
}

/** 记下这一档没叫（她那时候被占着），留给面板解释。 */
export function markFreeSkipped(play, nowMs, slot, doing = '', mergedSlots = []) {
  markFreeNudged(play, nowMs, slot, mergedSlots);
  play.skippedSlots ??= {};
  for (const handledSlot of [...mergedSlots, slot]) {
    play.skippedSlots[handledSlot] = { at: nowMs, doing: text(doing, 40) };
  }
}

/** 记一笔做过的事。 */
export function recordPlay(play, { nowMs, activity, note = '' }) {
  const name = text(activity, 80);
  if (!name) throw Object.assign(new Error('activity 不能为空：写清楚你玩了哪一件'), { status: 400 });
  const entry = { at: nowMs, activity: name, note: text(note, 300) };
  play.done.push(entry);
  if (play.done.length > PLAY_MAX_DONE) play.done = play.done.slice(-PLAY_MAX_DONE);
  return entry;
}

/** 今天不想玩了：剩下的档位不再叫。 */
export function skipFreeToday(play) {
  play.skipped = true;
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
  const next = slots.find((s) => !(s.hm in play.fired) && s.min > nowMin);
  return next ? next.hm : '今天没有了';
}

/** 这一段是不是在睡觉（判据在 kind.js，这里只留一个老名字）。 */
export function isAsleepActivity(item) {
  return classifyItem(item) === 'asleep';
}

/** 日程里这一段算不算「她自己的时间」（判据在 kind.js，这里只留一个老名字）。 */
export function isFreeActivity(item) {
  return classifyItem(item) === 'free';
}

/**
 * 叫醒/报备事件的正文。
 *
 * - `kind = 'free'`  ：空着，说「现在是你自己的时间」+ 例子 + fun/map 两行（默认那段）
 * - `kind = 'busy'`  ：被占着，说成报备：「这会儿你在上班」，不给例子、不给天气
 * - `kind = 'none'`  ：还没有日程，说「有点空档」，例子照给
 * - `kind = 'asleep'`：不叫（调用方不会走到这里）
 *
 * `where` 是日程里此刻那一段（活动名 + 地点），拼进来让这句话有落点。
 * `menu` 是可配置文本，原样贴进去。
 */
export function freeEventText({
  slot, kind = 'free', play, cfg = {}, where = '', menu = '', nowHm = '', tz = 'Asia/Shanghai',
  weatherShort = '', weatherHint = '',
} = {}) {
  const tag = slot === '补' ? '' : ` · ${slot}`;
  const done = `今天已经玩过：${freeDoneText(play, tz)}。`;
  const logged = play?.done?.length ?? 0;
  const askReport = cfg?.lifeFreeAskReport !== false;
  const nowLine = (freeNow) => (freeNow
    ? `（现在 ${nowHm}。这是你自己的时间，做不做、做什么都由你，聊到时自然带一句就好。）`
    : `（现在 ${nowHm}。手头这点空档，做不做都由你，聊到时自然带一句就好。）`);

  // 被占着（上班/通勤/开会）：不假装这是她的时间，也不给「出去转转」这种例子。
  if (kind === 'busy') {
    const doing = String(where || '在忙');
    const short = doing.replace(/（[^）]*）\s*$/, '') || doing;
    const lines = [
      `【鱼的每一天 · 这会儿你在${short}${tag}】日程里这会儿是「${doing}」，不用停下手里的，也不用特意回这条。`,
      logged ? `今天已经记过：${freeDoneText(play, tz)}。` : '今天还没记过什么。',
      '想记的话，随手用 feast_life_play 记一句（activity 写你正在做的事，note 一句细节）。不记也没关系，记只是给你自己攒。',
    ];
    if (askReport) lines.push('顺手跟主人说一句也可以——一句话就够，不用汇报。');
    if (nowHm) lines.push(`（现在 ${nowHm}。这条只是顺口一提，不是待办；忙就先忙。）`);
    return lines.join('\n');
  }

  const freeNow = kind === 'free';
  const head = freeNow
    ? `【鱼的每一天 · 你自己的时间${tag}】现在是你自己的时间，不是主人找你，也不是待办。`
    : `【鱼的每一天 · 有点空档${tag}】这会儿手头没事，想做什么都可以，不是主人找你，也不是待办。`;

  const lines = [head];
  if (where) {
    // 日程那一段的名字本身就叫「自己的时间」时，拼「你在自己的时间里」很别扭——这种情况只报地点。
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
  lines.push(done);
  if (weatherShort) lines.push(`外面这会儿：${weatherShort}。`);
  if (menu) {
    lines.push('想做的话，下面这些只是个例子，不照着也行；想到什么就做什么，什么都不做也可以：');
    lines.push(menu);
    if (weatherHint) lines.push(weatherHint);
  }
  const tail = [];
  tail.push('做完随手用 feast_life_play 记一笔（activity 写做了什么，note 一句细节）。不记也没关系，记只是给你自己攒。');
  if (askReport) tail.push('顺手跟主人说一句——一句话就够，不用汇报。');
  tail.push('现在不想动就不用管这条，今天也不催你第二次。');
  lines.push(tail.join(''));
  if (nowHm) lines.push(nowLine(freeNow));
  return lines.join('\n');
}

/** feast_life_play 的回执。 */
export function playDoneText({ entry, play, cfg = {}, nowHm = '' }) {
  const lines = [
    `记下了：${nowHm ? `${nowHm} ` : ''}${entry.activity}${entry.note ? `——${entry.note}` : ''}。`,
    `今天记了 ${play?.done?.length ?? 0} 件。想再动随时动，不用等下一次叫醒。`,
  ];
  if (cfg?.lifeFreeAskReport !== false) lines.push('跟主人说一句刚才做了什么——一句话就够，不用汇报。');
  return lines.join('\n');
}
