/**
 * 一桌菜的纯状态逻辑：算日子、算饭点、判断这一拍该不该叫她。
 *
 * 不碰文件、不碰定时器、不碰宿主，便于单测；World 只负责把结果变成事件和工具回执。
 *
 * 与「自由时间」的 state.js 是同构的，但这里多两件事：
 *   · 吃过什么（eaten / reactions / counts）是**跨天累积**的，不随跨天清零；
 *   · 主人端来的菜（served）有自己的有效期。
 * 只有饭点的 fired / pending / skippedDay 是当天的事。
 */

const DAY_FMT = new Map();
const HM_FMT = new Map();

function dayFormatter(tz) {
  let f = DAY_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    DAY_FMT.set(tz, f);
  }
  return f;
}

function hmFormatter(tz) {
  let f = HM_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    HM_FMT.set(tz, f);
  }
  return f;
}

/** 本地日期 YYYY-MM-DD。 */
export function dayIn(tz, nowMs) {
  return dayFormatter(tz).format(new Date(nowMs));
}

/** 本地时刻 HH:MM。 */
export function hmIn(tz, nowMs) {
  return hmFormatter(tz).format(new Date(nowMs));
}

/** 本地当天第几分钟（0–1439）。 */
export function minutesIn(tz, nowMs) {
  const [h, m] = hmIn(tz, nowMs).split(':').map(Number);
  return h * 60 + m;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 保留的吃过的条数；再多了就把最老的挤出去。 */
export const EATEN_KEEP = 200;
/** 保留的反应条数。 */
export const REACTIONS_KEEP = 300;

/**
 * 解析档位：`11:30,18:00` → [{ hm:'11:30', min:690 }]，去重、排序、丢掉非法项。
 * 中文逗号和空白也认。
 */
export function parseSlots(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[,，\s]+/)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (!m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    const hm = `${String(h).padStart(2, '0')}:${m[2]}`;
    if (seen.has(hm)) continue;
    seen.add(hm);
    out.push({ hm, min: h * 60 + min });
  }
  return out.sort((a, b) => a.min - b.min);
}

/** 当天的新状态（吃过的记录是跨天的，新状态从空开始）。 */
export function newState(day) {
  return {
    day,
    eaten: [],
    reactions: [],
    counts: {},
    fired: {},
    pending: null,
    skippedDay: '',
    served: null,
  };
}

/** 把磁盘上的旧状态补齐成当前形状（不信任文件内容）。 */
export function normalizeState(raw, day) {
  const s = newState(day);
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.day === 'string' && raw.day) s.day = raw.day;

  if (Array.isArray(raw.eaten)) {
    s.eaten = raw.eaten
      .filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.id)
      .map((e) => ({
        id: String(e.id).slice(0, 80),
        name: typeof e.name === 'string' ? e.name.slice(0, 60) : '',
        at: Number(e.at) || 0,
        by: e.by === 'owner' ? 'owner' : 'self',
        miss: e.miss === true,
      }))
      .slice(-EATEN_KEEP);
  }

  if (Array.isArray(raw.reactions)) {
    s.reactions = raw.reactions
      .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id)
      .map((r) => ({
        id: String(r.id).slice(0, 80),
        name: typeof r.name === 'string' ? r.name.slice(0, 60) : '',
        liked: r.liked === true ? true : r.liked === false ? false : null,
        note: typeof r.note === 'string' ? r.note.slice(0, 200) : '',
        at: Number(r.at) || 0,
      }))
      .slice(-REACTIONS_KEEP);
  }

  if (raw.counts && typeof raw.counts === 'object' && !Array.isArray(raw.counts)) {
    for (const [k, v] of Object.entries(raw.counts)) {
      const n = Number(v);
      if (typeof k === 'string' && k && Number.isFinite(n) && n > 0) s.counts[k] = Math.min(9999, Math.round(n));
    }
  }

  if (raw.fired && typeof raw.fired === 'object' && !Array.isArray(raw.fired)) {
    for (const [k, v] of Object.entries(raw.fired)) {
      if (/^\d{2}:\d{2}$/.test(k) || k === '补') s.fired[k] = Number(v) || 0;
    }
  }

  if (raw.pending && typeof raw.pending === 'object' && typeof raw.pending.slot === 'string') {
    s.pending = {
      slot: raw.pending.slot,
      since: Number(raw.pending.since) || 0,
      lastNudgeAt: Number(raw.pending.lastNudgeAt) || 0,
      retries: Number(raw.pending.retries) || 0,
    };
  }

  if (typeof raw.skippedDay === 'string') s.skippedDay = raw.skippedDay;

  if (raw.served && typeof raw.served === 'object' && typeof raw.served.id === 'string' && raw.served.id) {
    s.served = { id: String(raw.served.id).slice(0, 80), at: Number(raw.served.at) || 0 };
  }

  return s;
}

/**
 * 跨天清零：只清饭点那套（今天叫过哪些档、在等哪一档、今天跳过没）。
 * 吃过什么、反应、计数都留着——那是她自己的记忆。
 */
export function rollover(state, day) {
  if (state.day === day) {
    if (state.skippedDay && state.skippedDay !== day) state.skippedDay = '';
    return false;
  }
  state.day = day;
  state.fired = {};
  state.pending = null;
  state.skippedDay = '';
  return true;
}

/**
 * 这一拍该做什么：
 *  - fire  ：到某一档（catchup = 应用开晚了，补一顿）
 *  - retry ：上一档叫了没见她吃，到催的时间
 *  - drop  ：这一档催完了/挂太久了，放掉等下一顿
 *  - none  ：安静
 */
export function planTick(state, cfg, nowMs, tz) {
  const day = dayIn(tz, nowMs);
  rollover(state, day);
  if (cfg.mealReminder === false) return { action: 'none' };
  if (state.skippedDay === day) return { action: 'none' };

  const slots = parseSlots(cfg.mealSlots);
  if (!slots.length) return { action: 'none' };

  const nowMin = minutesIn(tz, nowMs);
  const grace = clampInt(cfg.mealGraceMin, 1, 180, 20);
  const retryMin = clampInt(cfg.mealRetryMin, 5, 240, 40);
  const maxRetries = clampInt(cfg.mealMaxRetries, 0, 5, 1);
  /** 上一顿被放掉的原因；有的话会在这一拍末尾如实报出去。 */
  let dropped = '';

  if (state.pending) {
    const age = Math.max(0, nowMs - state.pending.lastNudgeAt);
    if (age <= 2 * 3600_000) {
      if (maxRetries > 0 && state.pending.retries < maxRetries && age >= retryMin * 60_000) {
        return { action: 'retry', slot: state.pending.slot };
      }
      if (!(maxRetries === 0 || state.pending.retries >= maxRetries)) return { action: 'none' };
    }
    // 这一顿不再等了（挂太久，或催完了）。放掉它，但**同一拍还要看看有没有新档**——
    // 午饭一直没吃不等 18:00 那顿也一起吞掉。
    dropped = age > 2 * 3600_000 ? '挂太久了' : '这一顿催完了';
    state.pending = null;
  }

  for (const s of slots) {
    if (!state.fired[s.hm] && nowMin >= s.min && nowMin - s.min <= grace) {
      return { action: 'fire', slot: s.hm, catchup: false, dropped };
    }
  }

  // 今天一档都没叫过，但已经错过了（应用 15:00 才开）：补最近过去的那一顿，别让一整天白过。
  if (Object.keys(state.fired).length === 0) {
    const passed = slots.filter((s) => nowMin >= s.min + grace);
    if (passed.length) {
      const last = passed[passed.length - 1];
      return { action: 'fire', slot: last.hm, catchup: true, dropped };
    }
  }

  if (dropped) return { action: 'drop', reason: dropped };
  return { action: 'none' };
}

/** 记下这一档已叫（retry 时只累加次数）。 */
export function markNudged(state, nowMs, slot, retry = false) {
  if (retry && state.pending) {
    state.pending.retries += 1;
    state.pending.lastNudgeAt = nowMs;
    return;
  }
  state.fired[slot] = nowMs;
  state.pending = { slot, since: nowMs, lastNudgeAt: nowMs, retries: 0 };
}

/**
 * 记一顿吃过的。返回记下的条目。
 * 顺手清掉 pending（叫的那一顿有着落了）和 served（端来的菜已经进嘴了）。
 */
export function recordEat(state, { nowMs, dish, by = 'self', miss = false }) {
  if (!dish || typeof dish !== 'object' || !dish.id) throw new Error('dish 不对');
  const entry = {
    id: String(dish.id),
    name: typeof dish.name === 'string' ? dish.name : '',
    at: nowMs,
    by: by === 'owner' ? 'owner' : 'self',
    miss: miss === true,
  };
  state.eaten.push(entry);
  if (state.eaten.length > EATEN_KEEP) state.eaten = state.eaten.slice(-EATEN_KEEP);
  state.counts[entry.id] = Math.min(9999, (state.counts[entry.id] ?? 0) + 1);
  state.pending = null;
  state.served = null;
  return entry;
}

/** 她自己对某道菜的反应。 */
export function recordReaction(state, { nowMs, id, name = '', liked = null, note = '' }) {
  const entry = {
    id: String(id ?? ''),
    name: String(name ?? '').slice(0, 60),
    liked: liked === true ? true : liked === false ? false : null,
    note: String(note ?? '').trim().slice(0, 200),
    at: nowMs,
  };
  if (!entry.id) throw new Error('反应要带上菜名');
  state.reactions.push(entry);
  if (state.reactions.length > REACTIONS_KEEP) state.reactions = state.reactions.slice(-REACTIONS_KEEP);
  return entry;
}

/** 她吃过这道菜几回（0 = 还没吃过）。 */
export function eatCount(state, id) {
  return state.counts?.[id] ?? 0;
}

/** 上一次吃的是哪一道（没有就 null）。 */
export function lastEaten(state) {
  return state.eaten.length ? state.eaten[state.eaten.length - 1] : null;
}

/** 主人端了一道菜过来（等着她吃）。 */
export function setServed(state, { nowMs, id }) {
  state.served = { id: String(id), at: nowMs };
  return state.served;
}

/** 端来的菜过期了就撤掉；返回是否还在等。 */
export function servedStillFresh(state, nowMs, ttlMin) {
  if (!state.served) return false;
  const ttl = clampInt(ttlMin, 1, 240, 30) * 60_000;
  if (nowMs - state.served.at > ttl) {
    state.served = null;
    return false;
  }
  return true;
}

/** 今天吃过什么（按时间正序，一行一道）。 */
export function eatenTodayText(state, tz, nowMs) {
  const day = dayIn(tz, nowMs);
  const today = state.eaten.filter((e) => dayIn(tz, e.at) === day);
  if (!today.length) return '还没吃';
  return today.map((e) => `${hmIn(tz, e.at)} ${e.name || e.id}${e.by === 'owner' ? '（主人端的）' : ''}`).join('；');
}

/** 最近吃过的几道（跨天，倒序）。 */
export function recentEaten(state, n = 6) {
  return state.eaten.slice(-n).reverse();
}

/** 下一顿是哪一顿。 */
export function nextMealText(state, cfg, nowMs, tz) {
  if (cfg.mealReminder === false) return '提醒关着';
  const slots = parseSlots(cfg.mealSlots);
  if (!slots.length) return '没排饭点';
  const nowMin = minutesIn(tz, nowMs);
  const next = slots.find((s) => !state.fired[s.hm] && s.min > nowMin);
  return next ? next.hm : '今天没有了';
}

/** 今天不想吃：剩下的饭点不再叫。 */
export function skipToday(state, day) {
  state.skippedDay = day;
  state.pending = null;
}

/** 状态页一行话。 */
export function statusLine(state, cfg, nowMs, tz) {
  const remind = cfg.mealReminder === false ? '提醒关着' : `下一顿 ${nextMealText(state, cfg, nowMs, tz)}`;
  const pending = state.pending ? ` · 在等「${state.pending.slot}」这顿` : '';
  const eaten = state.eaten.filter((e) => dayIn(tz, e.at) === dayIn(tz, nowMs)).length;
  return `今天吃了 ${eaten} 道 · ${remind}${pending}`;
}
