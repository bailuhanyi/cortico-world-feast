/**
 * 日程的形状、校验、日型挑选、兜底模板与临时调整。
 *
 * 一天的形状：
 *   { date, dayType: { id, name }, title, mood,
 *     items: [{ start, end, activity, location, detail, situation?, scene?, outfit?, props?, with? }],
 *     source: 'coo'|'template'|'pending'|'manual', by, generatedAt, changes: [{ at, by, note }] }
 * items 从 00:00 连续排到 24:00，不重叠、没有空档（normalizeItems 负责修补）。
 *
 * 0.7.1 起 scene / outfit / props 会跟生图素材库联动（见 wardrobe.js）：
 * 库里有正名就归一，模型没填 outfit 时按习惯补。
 */
import { clock, parseClock, weekdayOf } from './time.js';
import { isWorkEvent, validCategory } from './kind.js';
export { categoryOf, isWorkEvent, validCategory } from './kind.js';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = parseClock(raw.start);
  const end = parseClock(raw.end);
  if (start === null || end === null) return null;
  const activity = text(raw.activity, 40);
  if (!activity) return null;
  const category = validCategory(raw.category) ? raw.category : '';
  const item = {
    ...(category ? { category } : {}),
    s: start,
    e: end === 0 && start > 0 ? 1440 : end,
    activity,
    location: text(raw.location, 30),
    detail: text(raw.detail, 240),
  };
  const sit = text(raw.situation, 20);
  if (sit) item.situation = sit;
  const scene = text(raw.scene, 40);
  if (scene) item.scene = scene;
  const outfit = text(raw.outfit, 40);
  if (outfit) item.outfit = outfit;
  // 这件衣服是哪儿来的：模型自己写的 / 情境穿搭 / 情境默认 / 延续上一段 / 场景默认 / 她的默认。
  // 0.7.2 补：以前 cleanItem 不认这个字段，enrichItems 标完一落盘就没了，
  // 面板和排错时都分不清「她写的」和「自动补的」。
  const src = text(raw.outfitSource, 20);
  if (src) item.outfitSource = src;
  const note = text(raw.outfitNote ?? raw.outfit_note, 60);
  if (note) item.outfitNote = note;
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [])
    .map((x) => text(x, 40)).filter(Boolean).slice(0, 4);
  const props = list(raw.props);
  if (props.length) item.props = props;
  const withs = list(raw.with);
  if (withs.length) item.with = withs;
  if (raw.workFreed === true) item.workFreed = true;
  return item;
}

const SLEEP = { activity: '睡觉', location: '家', detail: '' };

/** 排序、去重叠、补空档，保证覆盖 00:00–24:00；超过上限则整份拒绝，不能截掉末段。 */
export function normalizeItems(list, max = 40) {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw Object.assign(new RangeError('日程段数上限必须是正整数'), { status: 400 });
  }
  const items = (Array.isArray(list) ? list : []).map(cleanItem).filter(Boolean).filter((x) => x.e > x.s);
  items.sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev) {
      if (it.e <= prev.e) continue;
      if (it.s < prev.e) it.s = prev.e;
      else if (it.s > prev.e) prev.e = it.s;
    }
    if (it.e > it.s) out.push(it);
  }
  if (out.length === 0) return [{ start: '00:00', end: '24:00', ...SLEEP, activity: '在家' }];
  if (out[0].s > 0) out.unshift({ s: 0, e: out[0].s, ...SLEEP });
  const last = out[out.length - 1];
  if (last.e < 1380) out.push({ s: last.e, e: 1380, activity: '在家休息', location: '家', detail: '' });
  if (out[out.length - 1].e < 1440) out.push({ s: out[out.length - 1].e, e: 1440, ...SLEEP });
  if (out.length > max) {
    throw Object.assign(new RangeError(`日程补齐全天后有 ${out.length} 段，超过上限 ${max} 段；请合并活动后重新提交。`), {
      status: 400, code: 'SCHEDULE_ITEMS_LIMIT',
    });
  }
  return out.map(({ s, e, ...rest }) => ({ start: clock(s), end: clock(e), ...rest }));
}

export function findItem(day, minute) {
  if (!day || !Array.isArray(day.items)) return -1;
  return day.items.findIndex((it) => parseClock(it.start) <= minute && minute < parseClock(it.end));
}

/** 六种日型。guide 是请 Coo 自己写明天时给她的方向，不是排好的日程。 */
export const DEFAULT_DAY_TYPES = [
  {
    id: 'workday', name: '上班日', enabled: true, weight: 5, days: 'weekday',
    guide: '常规上班日，两点一线：起床洗漱、通勤、白天干活（偶尔偷偷摸鱼）、中午吃饭、傍晚回家、晚上有一点自己的时间，然后睡觉。',
  },
  {
    id: 'restday', name: '休息日', enabled: true, weight: 4, days: 'weekend',
    guide: '不上班，以在家为主：睡个懒觉，收拾屋子、看剧打游戏，出门散散步，去附近的馆子好好吃一顿，晚上在家放松。',
  },
  {
    id: 'outing', name: '外出日', enabled: true, weight: 2, days: 'weekend',
    guide: '出门玩一整天：逛街、看展、去公园、找好吃的店，傍晚或晚上才回家，回家时有点累但很满足。',
  },
  {
    id: 'homebody', name: '宅家日', enabled: true, weight: 1, days: 'any',
    guide: '哪儿也不想去，一整天窝在家：睡到中午，点外卖，追剧打游戏，作息有点乱，晚上反而精神。',
  },
  {
    id: 'overtime', name: '加班日', enabled: true, weight: 1, days: 'weekday',
    guide: '活多的一天：照常上班，一直忙到很晚，午饭晚饭都随便对付，回家已经很累，倒头就睡。',
  },
  {
    id: 'slacking', name: '摸鱼日', enabled: true, weight: 1, days: 'weekday',
    guide: '名义上在上班，实际上一直找机会摸鱼：开小差、刷手机、去茶水间找零食，下班前把要紧的事赶完。',
  },
];

export const DAY_SCOPES = ['weekday', 'weekend', 'any'];

/** 这几种日型都意味着「今天上班」。判据只此一处，别在别处再列一遍。 */
export const WORK_DAY_TYPES = Object.freeze(['workday', 'overtime', 'slacking']);

/** 撤销只比较工作状态、日型和时段；饭点变化不妨碍撤销。 */
export const workScheduleKey = (day) => JSON.stringify([day.work, day.dayType, day.items]);

/** 关闭上班后移除工作内容，以中性居家安排填回原时段。 */
export function removeWorkEvents(items) {
  return (Array.isArray(items) ? items : []).map((item) => isWorkEvent(item)
    ? { start: item.start, end: item.end, activity: '自由安排', category: 'personal', workFreed: true, location: '家', detail: '' }
    : item);
}

/** 这一天（按日型）是不是上班的日子。日型为空时按「不上班」算。 */
export function isWorkDayType(type) {
  const id = typeof type === 'string' ? type : type?.id;
  return WORK_DAY_TYPES.includes(String(id ?? ''));
}

/** 她自己定的一天最多几档饭点。再多就不是「几点吃」而是又一个时间表了。 */
export const MAX_OWN_MEAL_SLOTS = 4;

/**
 * 她自己定下的饭点：`['11:30','18:00']` 或 `'11:30,18:00'` → 去重排序后的 `['11:30','18:00']`。
 *
 * 和配置里的 `mealSlots` 分开：那个是**兜底**，这个是**那一天**的决定。
 * 空数组 = 她没定（调用方据此退回兜底），不是「今天不吃了」。
 * 非法项丢掉；整份都非法时返回空数组，由调用方兜底——不因为写错一个值就整天不叫她。
 */
export function cleanMealSlots(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,，\s]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const m = /^(\d{1,2})[:：](\d{2})$/.exec(String(item ?? '').trim());
    if (!m) continue;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) continue;
    const hm = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    if (seen.has(hm)) continue;
    seen.add(hm);
    out.push(hm);
    if (out.length >= MAX_OWN_MEAL_SLOTS) break;
  }
  return out.sort();
}

/** 不信任外部给的日型表：去重、截断、补默认值。 */
export function normalizeDayTypes(list) {
  const src = Array.isArray(list) ? list : DEFAULT_DAY_TYPES;
  const out = [];
  const seen = new Set();
  for (const raw of src.slice(0, 30)) {
    if (!raw || typeof raw !== 'object') continue;
    const name = text(raw.name, 20);
    if (!name) continue;
    let id = text(raw.id, 40).replace(/[^\w-]/g, '') || `type-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    out.push({
      id,
      name,
      enabled: raw.enabled !== false,
      weight: Math.min(100, Math.max(0, Math.round(Number(raw.weight) || 1))),
      days: DAY_SCOPES.includes(raw.days) ? raw.days : 'any',
      guide: text(raw.guide, 1000),
    });
  }
  return out.length ? out : normalizeDayTypes(DEFAULT_DAY_TYPES);
}

/**
 * 按星期挑一个日型（加权随机）；forcedId 指定时直接用它。
 *
 * `work` 给了就按「今天上不上班」的先后来挑：`false` 时**只在不上班的日型里挑**
 * （休息/外出/宅家），`true` 时只在上班的日型里挑。这是主人翻那个开关时
 * 真正起作用的地方——不然「今天不上班」只剩下一个标记，日程照旧排成上班日。
 *
 * 两种池子都会先按星期分流（工作日/周末）再落回来；某一类被她关光了
 * （enabled 全 false）时退回「同一类里能用的全部」，仍为空就用该类的第一个内置日型。
 */
export function pickDayType(types, date, forcedId = '', rand = Math.random, work = null) {
  const list = Array.isArray(types) && types.length ? types : DEFAULT_DAY_TYPES;
  if (forcedId) {
    const t = list.find((x) => x.id === forcedId || x.name === forcedId);
    if (t) return t;
  }
  return pickByWork(list, date, rand, work);
}

/** 先按星期分流，再按权重随机；池子空时退回全部候选。`relaxScope` 时不分星期。 */
function pickWeighted(pool, scope, rand, relaxScope = false) {
  let candidates = relaxScope ? pool : pool.filter((t) => t.days === scope || t.days === 'any');
  if (!candidates.length) candidates = pool;
  const total = candidates.reduce((n, t) => n + t.weight, 0);
  let r = rand() * total;
  for (const t of candidates) {
    r -= t.weight;
    if (r < 0) return t;
  }
  return candidates[candidates.length - 1];
}

/** pickDayType 的实现：先按上班/不上班筛，再按星期筛，最后加权随机。 */
function pickByWork(list, date, rand, work) {
  const wd = weekdayOf(date);
  const scope = wd === 0 || wd === 6 ? 'weekend' : 'weekday';
  const enabled = list.filter((t) => t.enabled && t.weight > 0);
  const explicit = work === true || work === false;
  const want = explicit ? (t) => isWorkDayType(t) === work : () => true;
  const pool = enabled.filter(want);
  // 她/主人明确说了「今天上班/不上班」时**不看星期**：周四说不上班，该能挑到休息日，
  // 而不是因为休息日标着周末就只剩宅家日。星期分流只用于没被指定的时候。
  if (pool.length) return pickWeighted(pool, scope, rand, explicit);
  // 这一类被她关光了：退回这一类里内置的那个，别悄悄给回上班日。
  const fallback = DEFAULT_DAY_TYPES.find((t) => want(t));
  if (fallback) return fallback;
  return list.find((t) => t.enabled) ?? DEFAULT_DAY_TYPES[1];
}

const WORKISH = new Set(WORK_DAY_TYPES);

/** Coo 没写时的兜底：按日型给一份朴素但完整的一天。 */
export function templateItems(type) {
  const it = (start, end, activity, location, detail = '') => ({ start, end, activity, location, detail });
  if (WORKISH.has(type.id)) {
    const off = type.id === 'overtime' ? '21:00' : '18:00';
    return normalizeItems([
      it('00:00', '07:30', '睡觉', '家'),
      it('07:30', '08:15', '起床洗漱、吃早饭', '家'),
      it('08:15', '09:00', '通勤', '路上'),
      it('09:00', '12:00', type.id === 'slacking' ? '上班（偷偷摸鱼）' : '上班', '公司'),
      it('12:00', '13:00', '吃午饭', '公司附近'),
      it('13:00', off, type.id === 'slacking' ? '上班（继续摸鱼）' : '上班', '公司'),
      it(off, type.id === 'overtime' ? '21:45' : '18:45', '下班回家', '路上'),
      it(type.id === 'overtime' ? '21:45' : '18:45', type.id === 'overtime' ? '22:30' : '19:45', '吃晚饭', '家'),
      it(type.id === 'overtime' ? '22:30' : '19:45', '23:00', '自己的时间', '家'),
      it('23:00', '24:00', '睡觉', '家'),
    ]);
  }
  if (type.id === 'outing') {
    return normalizeItems([
      it('00:00', '08:30', '睡觉', '家'),
      it('08:30', '10:00', '起床收拾、出门', '家'),
      it('10:00', '12:30', '逛街', '市中心'),
      it('12:30', '14:00', '吃午饭', '餐馆'),
      it('14:00', '17:30', '到处逛逛', '公园'),
      it('17:30', '19:00', '吃晚饭', '餐馆'),
      it('19:00', '20:00', '回家', '路上'),
      it('20:00', '23:30', '在家休息', '家'),
      it('23:30', '24:00', '睡觉', '家'),
    ]);
  }
  return normalizeItems([
    it('00:00', '09:30', '睡觉', '家'),
    it('09:30', '10:30', '起床、吃早午饭', '家'),
    it('10:30', '13:00', '在家玩', '家'),
    it('13:00', '15:00', '午睡', '家'),
    it('15:00', '16:30', '出门散步', '附近'),
    it('16:30', '18:00', '在家看剧', '家'),
    it('18:00', '19:30', '吃晚饭', type.id === 'homebody' ? '家' : '附近的餐馆'),
    it('19:30', '23:30', '自己的时间', '家'),
    it('23:30', '24:00', '睡觉', '家'),
  ]);
}

/**
 * 临时改主意：用新的一段覆盖 [start, end)，原来的安排被截断或拆开。
 *
 * `activity` 留空 = **不做了**（取消这一段），此时不插入新段，只把这一区间挖掉。
 * 挖出来的洞归**后面那一段**（「算了不去了，直接开始下一件」），而不是让前一段
 * 无限拉长——否则取消「出门散步」会把上一段「吃午饭」拉成三个小时，那是在撒谎。
 * 后面没有段可归（取消的是当天最后一件事）时，才把前一段延到 end。
 */
export function applyChange(items, change) {
  const s = parseClock(change.start);
  const e = parseClock(change.end);
  if (s === null || e === null || e <= s) {
    throw Object.assign(new Error('时间不对：start 和 end 用 HH:MM，end 要晚于 start'), { status: 400 });
  }
  const cancel = !String(change.activity ?? '').trim();
  const add = cancel ? null : cleanItem({ ...change });
  if (!cancel && !add) throw Object.assign(new Error('要写清楚做什么（activity）；不想做了就把它留空'), { status: 400 });

  const out = [];
  for (const it of items) {
    const a = parseClock(it.start);
    const b = parseClock(it.end);
    if (b <= s || a >= e) { out.push(it); continue; }
    if (a < s) out.push({ ...it, end: clock(s) });
    if (b > e) out.push({ ...it, start: clock(e) });
  }

  if (!cancel) {
    const { s: _s, e: _e, ...rest } = add;
    out.push({ start: clock(s), end: clock(e), ...rest });
    return normalizeItems(out);
  }

  // 取消：把 [s,e) 这个洞塞给后面那一段，让它提前开始。
  // 但**取消开头那一截**（比如「今天不睡那么久」）不能把后一段拉到 00:00——
  // 那会变成「凌晨就开始洗漱」。这种情况让前一段保持到 s 之后没有前段可延，
  // 于是给洞补一个中性的「在家」段。
  const byStart = out
    .filter((it) => parseClock(it.start) < parseClock(it.end))
    .sort((x, y) => parseClock(x.start) - parseClock(y.start));
  if (!byStart.length) return normalizeItems([]);
  const iNext = byStart.findIndex((it) => parseClock(it.start) >= e);
  const iPrev = byStart.findIndex((it) => parseClock(it.end) <= s && parseClock(it.end) === s);
  if (parseClock(byStart[0].start) >= e && parseClock(byStart[0].start) > s) {
    // 洞在开头：补一段中性内容，别让后一段顶到 00:00。
    byStart.unshift({ start: clock(s), end: clock(e), activity: '在家', location: '家', detail: '' });
  } else if (iNext >= 0) {
    byStart[iNext] = { ...byStart[iNext], start: clock(s) };
  } else if (iPrev >= 0) {
    byStart[iPrev] = { ...byStart[iPrev], end: clock(e) };
  } else {
    byStart[byStart.length - 1] = { ...byStart[byStart.length - 1], end: clock(e) };
  }
  return normalizeItems(byStart);
}
