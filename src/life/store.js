/**
 * 「她的一天」的存取。
 *
 * 每天一个文件：<dataDir>/feast/life/YYYY-MM-DD.json。
 * 与一桌菜的 state.json / combos.json 分开：清空「吃过的记录」不该把她的日子也清掉。
 * 写入一律 tmp → rename（和 World 主状态同一套原子写，断电不会留半个 JSON）。
 *
 * 这里没有「配置」：所有开关都走 worlds.feast.*（ctx.cfg，热改），
 * 日型表是代码里的常量 + 可选覆盖，不再另开一份 config.json。
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { addDays, isDateKey } from './time.js';
import { DEFAULT_DAY_TYPES, normalizeDayTypes, normalizeItems, pickDayType, templateItems } from './schedule.js';
import { cleanPlay, isAsleepActivity } from './free.js';

/** 面板的「往期」最多翻多少天。 */
export const LIFE_KEEP_DAYS = 30;

export function lifeDir(dataDir) {
  return join(dataDir, 'feast', 'life');
}

export function dayPath(dataDir, date) {
  return join(lifeDir(dataDir), `${date}.json`);
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * 不信任外部（Coo 交回的 JSON、手改过的文件）：规整成一天的形状。
 * pending 是「已经请她写、还没交回」的占位，items 必须是空的，
 * 否则 normalizeItems([]) 会补出「在家」一整天，看起来像她已经想好了。
 */
export function cleanDay(raw, date, opts = {}) {
  const types = normalizeDayTypes(opts.types ?? DEFAULT_DAY_TYPES);
  const src = raw && typeof raw === 'object' ? raw : {};
  const wanted = str(src.dayType?.id ?? src.dayType, 40) || str(src.dayTypeId, 40);
  const type = pickDayType(types, date, wanted);
  const source = ['coo', 'template', 'pending', 'manual'].includes(src.source) ? src.source : 'manual';
  const changes = Array.isArray(src.changes)
    ? src.changes.slice(-20).filter((c) => c && typeof c === 'object').map((c) => ({
      at: Number(c.at) || Date.now(),
      by: str(c.by, 20) || 'coo',
      note: str(c.note, 120),
    }))
    : [];
  return {
    date,
    dayType: { id: type.id, name: type.name },
    title: str(src.title, 60),
    mood: str(src.mood, 40),
    items: source === 'pending' ? [] : normalizeItems(src.items, opts.maxItems ?? 40),
    source,
    by: str(src.by, 20),
    generatedAt: Number(src.generatedAt) || Date.now(),
    changes,
  };
}

/** 请她写明天之前先落一个占位：重启也不会重复叫她写同一天。 */
export function pendingDay(date, type, now = Date.now()) {
  return cleanDay({ date, dayType: type, source: 'pending', by: 'timer', generatedAt: now }, date);
}

/** Coo 没写（或今天还没有）时的兜底，保证这一天总有内容。 */
export function templateDay(date, opts = {}) {
  const type = pickDayType(opts.types ?? DEFAULT_DAY_TYPES, date, opts.dayTypeId ?? '', opts.rand);
  return cleanDay({
    date,
    dayType: type,
    title: '',
    mood: '',
    items: templateItems(type),
    source: 'template',
    by: opts.by ?? 'timer',
    generatedAt: opts.now ?? Date.now(),
  }, date, opts);
}

export async function readDay(dataDir, date) {
  if (!isDateKey(date)) return null;
  try {
    const raw = JSON.parse(await readFile(dayPath(dataDir, date), 'utf8'));
    return cleanDay(raw, date);
  } catch {
    return null;
  }
}

export async function writeDay(dataDir, day) {
  if (!day || !isDateKey(day.date)) throw new Error('写日程要先有合法日期');
  const file = dayPath(dataDir, day.date);
  await mkdir(lifeDir(dataDir), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(day, null, 2), 'utf8');
  await rename(tmp, file);
  return day;
}

/** 最近的日期（新到旧），只看合法文件名的 .json。 */
export async function listDays(dataDir, limit = 14) {
  let names = [];
  try {
    names = await readdir(lifeDir(dataDir));
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && isDateKey(n.slice(0, 10)))
    .map((n) => n.slice(0, 10))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, Math.max(1, Math.min(LIFE_KEEP_DAYS, limit)));
}

/** 清掉「她的一天」的全部记录（不受面板往期上限限制）；state.json / combos.json 不受影响。 */
export async function clearDays(dataDir) {
  let names = [];
  try {
    names = await readdir(lifeDir(dataDir));
  } catch {
    return 0;
  }
  let n = 0;
  for (const file of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    try { await unlink(join(lifeDir(dataDir), file)); n += 1; } catch { /* 已经没了就算了 */ }
  }
  return n;
}

/** 最近几天的紧凑摘要，给「请她写明天」的事件当上下文。 */
export async function recentSummary(dataDir, date, n = 3) {
  const lines = [];
  for (let i = n; i >= 1; i -= 1) {
    const day = await readDay(dataDir, addDays(date, -i));
    if (!day || !day.items.length) continue;
    const main = day.items.filter((it) => !isAsleepActivity(it)).slice(0, 8).map((it) => it.activity).join('、');
    lines.push(`- ${day.date}（${day.dayType.name}）：${day.title ? `${day.title}。` : ''}${main ? `做了 ${main}` : ''}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 自由时间的记录
// ---------------------------------------------------------------------------

/**
 * 自由时间**单独一份文件**，不写进日程。
 *
 * 日程是 Coo 自己交回的内容（feast_life_plan 会整个重写一天），把「实际玩了什么」
 * 塞进去，她下次交回就覆盖了。计划和事实的生命周期不同，就该分开存。
 */
export function playPath(dataDir, date) {
  return join(lifeDir(dataDir), `play-${date}.json`);
}

export async function readPlay(dataDir, date) {
  if (!isDateKey(date)) return null;
  try {
    const raw = JSON.parse(await readFile(playPath(dataDir, date), 'utf8'));
    return cleanPlay(raw, date);
  } catch {
    return null;
  }
}

export async function writePlay(dataDir, play) {
  if (!play || !isDateKey(play.date)) throw new Error('写自由时间记录要先有合法日期');
  const file = playPath(dataDir, play.date);
  await mkdir(lifeDir(dataDir), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(play, null, 2), 'utf8');
  await rename(tmp, file);
  return play;
}

/** 清「她的一天」时把自由时间的记录一起清掉（同属她的日子）。 */
export async function clearPlays(dataDir) {
  let names = [];
  try {
    names = await readdir(lifeDir(dataDir));
  } catch {
    return 0;
  }
  let n = 0;
  for (const file of names) {
    if (!/^play-\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    try { await unlink(join(lifeDir(dataDir), file)); n += 1; } catch { /* 已经没了就算了 */ }
  }
  return n;
}
