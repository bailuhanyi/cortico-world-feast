/**
 * 「陪主人吃饭」的纯逻辑：这一顿的形状、开席/散桌、喂一口、回喂、邀请限流。
 *
 * 不碰文件、不碰定时器、不碰宿主，便于单测；World 只负责把结果变成事件和工具回执。
 * 和 `state.js` / `eat.js` / `combos.js` 同构。**不 import state.js**（那边要 import
 * 这里的 `normalizeTogether`，反过来就成了循环），需要状态的判据由调用方算好传进来。
 *
 * 三条账要分清（见 TOGETHER-SPEC 第 1.2 节）：
 *   · 主人喂她的一口  → 进 `eaten`（带 bite 标记），所以 nth 机制直接能用；
 *   · 她回喂主人的    → 只进这里的 `back`（gesture），不进 eaten；
 *   · 主人自己吃的    → 只进这里的 `ownerAte`，更不进 eaten。
 */

/** 这一顿最多留几条喂过的一口。 */
export const BITES_KEEP = 20;
/** 这一顿最多留几条「主人自己吃的」。 */
export const OWNER_ATE_KEEP = 10;
/** 这一顿最多留几条「她回喂的」。 */
export const BACK_KEEP = 10;
/** 她挂的那条邀请默认留多久（分钟）；配置可改。 */
export const INVITE_MIN = 20;
/** 她自己一天最多主动邀请几次；配置可改。 */
export const MAX_INVITES = 2;
/** 一顿默认最多挂多久（分钟）；配置可改。 */
export const TTL_MIN = 60;

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function int(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 没在一起吃时的形状。旧状态文件没有这个字段，一律走这里。 */
export function newTogether() {
  return {
    at: 0,
    starter: '',
    name: '',
    bites: [],
    ownerAte: [],
    back: [],
    invite: null,
    invites: { day: '', n: 0 },
    lastEnd: null,
  };
}

/** 把磁盘上的旧/坏数据洗成当前形状（不信任文件内容）。 */
export function normalizeTogether(raw) {
  const t = newTogether();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return t;

  t.at = int(raw.at, 0, Number.MAX_SAFE_INTEGER, 0);
  t.starter = raw.starter === 'her' ? 'her' : raw.starter === 'owner' ? 'owner' : '';
  t.name = str(raw.name, 60);

  if (Array.isArray(raw.bites)) {
    t.bites = raw.bites
      .filter((b) => b && typeof b === 'object' && str(b.id, 80))
      .map((b) => ({
        id: str(b.id, 80),
        name: str(b.name, 60),
        at: int(b.at, 0, Number.MAX_SAFE_INTEGER, 0),
        nth: int(b.nth, 0, 9999, 0),
      }))
      .slice(-BITES_KEEP);
  }

  if (Array.isArray(raw.ownerAte)) {
    t.ownerAte = raw.ownerAte
      .filter((e) => e && typeof e === 'object')
      .map((e) => {
        // 库内那道：要 id；自由文本：要一句能读的话。两样都没有就丢掉这一条。
        if (str(e.id, 80)) {
          return { kind: 'dish', id: str(e.id, 80), name: str(e.name, 60), note: '', at: int(e.at, 0, Number.MAX_SAFE_INTEGER, 0) };
        }
        const note = str(e.note, 200);
        return note ? { kind: 'note', id: '', name: '', note, at: int(e.at, 0, Number.MAX_SAFE_INTEGER, 0) } : null;
      })
      .filter(Boolean)
      .slice(-OWNER_ATE_KEEP);
  }

  if (Array.isArray(raw.back)) {
    t.back = raw.back
      .filter((g) => g && typeof g === 'object' && str(g.id, 80))
      .map((g) => ({
        id: str(g.id, 80),
        name: str(g.name, 60),
        at: int(g.at, 0, Number.MAX_SAFE_INTEGER, 0),
        ok: g.ok === true ? true : g.ok === false ? false : null,
      }))
      .slice(-BACK_KEEP);
  }

  const invAt = int(raw.invite?.at, 0, Number.MAX_SAFE_INTEGER, 0);
  t.invite = invAt > 0 ? { at: invAt } : null;

  t.invites = {
    day: typeof raw.invites?.day === 'string' ? raw.invites.day.slice(0, 10) : '',
    n: int(raw.invites?.n, 0, 99, 0),
  };

  const endAt = int(raw.lastEnd?.at, 0, Number.MAX_SAFE_INTEGER, 0);
  t.lastEnd = endAt > 0 ? { at: endAt, why: str(raw.lastEnd?.why, 20) } : null;

  return t;
}

/** 现在是不是正一起吃。 */
export function isTogether(together) {
  return Number(together?.at) > 0;
}

/** 开席：重置这一顿的三个数组，记住谁起的头。 */
export function startTogether(together, { nowMs, starter = 'owner', name = '' }) {
  together.at = nowMs;
  together.starter = starter === 'her' ? 'her' : 'owner';
  together.name = str(name, 60);
  together.bites = [];
  together.ownerAte = [];
  together.back = [];
  // 人都坐下来了，那条"想和你一起吃"就不必再挂着。
  together.invite = null;
  together.lastEnd = null;
  return together;
}

/** 主人喂她一口（进 eaten 由 World 那边记，这里只留这一顿的痕迹）。 */
export function addBite(together, { nowMs, dish, nth = 0 }) {
  const entry = {
    id: str(dish?.id, 80),
    name: str(dish?.name, 60),
    at: nowMs,
    nth: int(nth, 0, 9999, 0),
  };
  together.bites.push(entry);
  if (together.bites.length > BITES_KEEP) together.bites = together.bites.slice(-BITES_KEEP);
  return entry;
}

/** 这一顿这道喂过几口。 */
export function biteCount(together, id) {
  return together.bites.filter((b) => b.id === id).length;
}

/** 主人自己也吃点什么：库里点一道，或者一句自由文本。哪样都没有就不记。 */
export function setOwnerAte(together, { nowMs, dish = null, note = '' }) {
  const id = str(dish?.id, 80);
  const text = str(note, 200);
  if (!id && !text) return null;
  const entry = id
    ? { kind: 'dish', id, name: str(dish?.name, 60), note: '', at: nowMs }
    : { kind: 'note', id: '', name: '', note: text, at: nowMs };
  together.ownerAte.push(entry);
  if (together.ownerAte.length > OWNER_ATE_KEEP) {
    together.ownerAte = together.ownerAte.slice(-OWNER_ATE_KEEP);
  }
  return entry;
}

/** 主人最近一次吃的是什么（面板上那一行）。 */
export function lastOwnerAte(together) {
  return together.ownerAte.length ? together.ownerAte[together.ownerAte.length - 1] : null;
}

/** 她分主人一口（gesture；**不进 eaten**——那不是她吃）。 */
export function addBack(together, { nowMs, dish }) {
  const entry = { id: str(dish?.id, 80), name: str(dish?.name, 60), at: nowMs, ok: null };
  together.back.push(entry);
  if (together.back.length > BACK_KEEP) together.back = together.back.slice(-BACK_KEEP);
  return entry;
}

/** 最近那条主人还没回应的回喂。 */
export function pendingBack(together) {
  for (let i = together.back.length - 1; i >= 0; i -= 1) {
    if (together.back[i].ok === null) return together.back[i];
  }
  return null;
}

/** 主人回应她的回喂：接过来了（ok）还是这次没要。没有未回应的那条就返回 null。 */
export function answerBack(together, { ok }) {
  const g = pendingBack(together);
  if (!g) return null;
  g.ok = ok === true;
  return g;
}

// ---------------------------------------------------------------------------
// 邀请（她 → 主人）。主人 → 她走事件，不需要这些。
// ---------------------------------------------------------------------------

/** 她挂着的那条邀请还剩几分钟；没挂就是 0。 */
export function inviteLeftMin(together, nowMs, windowMin = INVITE_MIN) {
  if (!together?.invite) return 0;
  const w = Math.max(1, Number(windowMin) || INVITE_MIN) * 60_000;
  const leftMs = together.invite.at + w - nowMs;
  return leftMs <= 0 ? 0 : Math.ceil(leftMs / 60_000);
}

/** 到点了就把那条挂着的邀请放掉。返回"刚放掉"这件事有没有发生。 */
export function dropStaleInvite(together, nowMs, windowMin = INVITE_MIN) {
  if (!together?.invite) return false;
  if (inviteLeftMin(together, nowMs, windowMin) > 0) return false;
  together.invite = null;
  return true;
}

/** 今天她已经主动邀请过几次（跨天自动归零）。 */
export function invitesToday(together, day) {
  return together?.invites?.day === day ? together.invites.n : 0;
}

/**
 * 她想邀请主人一起吃。
 *
 * 三种结果都要能如实说出来：已经挂着一条 / 今天用完了 / 挂上了。
 * **只管她自己**：主人想邀请几次都行（主人是人在点，不需要限流）。
 */
export function makeInvite(together, { nowMs, day, max = MAX_INVITES, windowMin = INVITE_MIN }) {
  dropStaleInvite(together, nowMs, windowMin);
  if (together.invite) {
    return { ok: false, reason: 'hanging', leftMin: inviteLeftMin(together, nowMs, windowMin) };
  }
  const used = invitesToday(together, day);
  const cap = Math.max(0, Number(max) || 0);
  if (used >= cap) return { ok: false, reason: 'capped', used, max: cap };
  together.invites = { day, n: used + 1 };
  together.invite = { at: nowMs };
  return { ok: true, used: used + 1, max: cap };
}

/** 主人把她那条邀请收掉（只是清面板，不等同于聊天里回绝）。 */
export function clearInvite(together) {
  const had = Boolean(together?.invite);
  if (together) together.invite = null;
  return had;
}

// ---------------------------------------------------------------------------
// 散桌
// ---------------------------------------------------------------------------

/**
 * 这一顿该散了吗。空串 = 继续。
 *
 * 判据由调用方从状态算好传进来（见 TOGETHER-SPEC 第 2.2 节）：
 *   · `ateSince`  ：这一顿开始之后她**真吃掉**了几道（喂的一口不算）
 *   · `tableEmpty`：现在桌上没剩的了
 */
export function togetherWhy(together, { nowMs, ttlMin = TTL_MIN, ateSince = 0, tableEmpty = false }) {
  if (!isTogether(together)) return '';
  if (ateSince > 0 && tableEmpty) return 'finished';
  const ttl = Math.max(1, Number(ttlMin) || TTL_MIN) * 60_000;
  if (nowMs - together.at >= ttl) return 'ttl';
  return '';
}

/**
 * 散桌。`bites/ownerAte/back` 留着（面板上还能回看"刚才这顿喂了三口"），
 * 只把这一顿的 `at` 归零并记下 `lastEnd`。返回这一顿的收尾快照（给事件正文用）。
 */
export function finishTogether(together, { nowMs, why = 'owner' }) {
  if (!isTogether(together)) return null;
  const ended = {
    at: together.at,
    starter: together.starter,
    name: together.name,
    why: str(why, 20) || 'owner',
    bites: together.bites.length,
    back: together.back.length,
  };
  together.at = 0;
  together.starter = '';
  together.name = '';
  together.lastEnd = { at: nowMs, why: ended.why };
  return ended;
}

// ---------------------------------------------------------------------------
// 面板要看的那一份
// ---------------------------------------------------------------------------

/**
 * 会话条要的全部内容。
 *
 * 只给"要显示的几条"（喂的最近 3 口、主人吃的最近 2 条、回喂最近 2 条），
 * 面板不关心整本账；但计数给全，好写"喂过 3 口"。
 */
export function togetherView(together, { nowMs, ttlMin = TTL_MIN, inviteWindowMin = INVITE_MIN } = {}) {
  const active = isTogether(together);
  const ttl = Math.max(1, Number(ttlMin) || TTL_MIN);
  const elapsedMin = active ? Math.max(0, Math.floor((nowMs - together.at) / 60_000)) : 0;
  const leftMs = active ? together.at + ttl * 60_000 - nowMs : 0;
  const back = together.back.slice(-2).reverse();
  return {
    active,
    at: together.at,
    starter: together.starter,
    name: together.name,
    elapsedMin,
    ttlMin: ttl,
    leftMin: active ? (leftMs <= 0 ? 0 : Math.ceil(leftMs / 60_000)) : 0,
    bites: together.bites.slice(-3).reverse(),
    biteCount: together.bites.length,
    ownerAte: together.ownerAte.slice(-2).reverse(),
    back,
    backPending: pendingBack(together),
    invite: together.invite ? { at: together.invite.at, leftMin: inviteLeftMin(together, nowMs, inviteWindowMin) } : null,
    lastEnd: together.lastEnd,
  };
}
