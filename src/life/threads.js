import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readStoredJson, writeStoredJson } from '../storage.js';

const FILE_NAME = 'threads.json';
const ACTIVE_LIMIT = 8;
const HISTORY_LIMIT = 32;
const STATUSES = new Set(['active', 'done', 'dropped']);
const SOURCES = new Set(['coo', 'owner']);
const cleanText = (value, field, max) => {
  if (typeof value !== 'string') throw new TypeError(`${field} 必须是字符串`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) throw new RangeError(`${field} 长度必须为 1-${max} 个字符`);
  return text;
};
const timestamp = (now) => {
  const value = now === undefined ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
  if (!Number.isFinite(value)) throw new TypeError('now must be a valid timestamp');
  return value;
};
const validDate = (value) => {
  try {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
};
const normalizeState = (state) => {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.items)) {
    throw new TypeError('小事记录结构无效：必须是包含 items 数组的对象');
  }
  const ids = new Set();
  let active = 0;
  let history = 0;
  for (const [index, item] of state.items.entries()) {
    const fail = (detail) => { throw new TypeError(`小事记录损坏：第 ${index + 1} 项（items[${index}]）${detail}`); };
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('必须是对象');
    if (typeof item.id !== 'string' || !item.id.trim()) fail('id 必须是非空字符串');
    if (ids.has(item.id)) fail(`id 重复：${item.id}`);
    ids.add(item.id);
    for (const field of ['text', 'sourceActivity']) {
      if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > 120) {
        fail(`${field} 必须是长度为 1-120 个字符的非空字符串`);
      }
    }
    if (!validDate(item.sourceDate)) fail('sourceDate 必须是合法的 YYYY-MM-DD 日期');
    if (!SOURCES.has(item.source)) fail('source 必须是 coo 或 owner');
    if (!STATUSES.has(item.status)) fail('status 必须是 active、done 或 dropped');
    for (const field of ['createdAt', 'updatedAt']) {
      if (!Number.isFinite(item[field])) fail(`${field} 必须是有限时间戳数字`);
    }
    if (item.status === 'active') active++;
    else history++;
  }
  if (active > ACTIVE_LIMIT) throw new RangeError('小事记录超限：进行中的小事最多 8 件');
  if (history > HISTORY_LIMIT) throw new RangeError('小事记录超限：历史小事最多 32 件');
  return state;
};
const retainHistory = (items) => {
  const historyIds = new Set(items.filter((item) => item.status !== 'active')
    .slice(0, HISTORY_LIMIT).map((item) => item.id));
  return items.filter((item) => item.status === 'active' || historyIds.has(item.id));
};

/** Read <dataDir>/feast/threads.json. Missing data is an empty collection. */
export async function readThreads(dataDir) {
  const file = join(dataDir, 'feast', FILE_NAME);
  const stored = await readStoredJson(file);
  if (stored === null) return { items: [] };
  try {
    return normalizeState(stored);
  } catch (err) {
    throw new Error(`小事记录损坏，原文件已保留：${file}（${err.message}）`, { cause: err });
  }
}

/** Persist the complete state at <dataDir>/feast/threads.json. */
export async function writeThreads(dataDir, state) {
  normalizeState(state);
  const file = join(dataDir, 'feast', FILE_NAME);
  await readThreads(dataDir);
  await mkdir(dirname(file), { recursive: true });
  return writeStoredJson(file, state);
}

/** Add only explicit text; return a new state, preserving all existing records. */
export function addThread(state, { text, sourceDate, sourceActivity, source, now, id } = {}) {
  normalizeState(state);
  const normalizedText = cleanText(text, 'text', 120);
  if (!validDate(sourceDate)) throw new TypeError('sourceDate 必须是合法的 YYYY-MM-DD 日期');
  const activity = cleanText(sourceActivity, 'sourceActivity', 120);
  if (!SOURCES.has(source)) throw new TypeError('source 必须是 coo 或 owner');
  const createdAt = timestamp(now);
  const itemId = id ?? randomUUID();
  if (typeof itemId !== 'string' || !itemId.trim()) throw new TypeError('id 必须是非空字符串');
  if (state.items.some((item) => item.id === itemId)) throw new Error(`小事记录 id 重复：${itemId}`);
  const existing = state.items.find((item) => item.status === 'active'
    && item.text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
      === normalizedText.toLocaleLowerCase('zh-CN'));
  if (existing) return state;
  if (state.items.filter((item) => item.status === 'active').length >= ACTIVE_LIMIT) {
    throw new RangeError('最多只能保留 8 件进行中的小事；请先明确完成或放下其中一件。');
  }
  const item = {
    id: itemId,
    text: normalizedText,
    status: 'active',
    sourceDate,
    sourceActivity: activity,
    source,
    createdAt,
    updatedAt: createdAt,
  };
  return normalizeState({ ...state, items: retainHistory([...state.items, item]) });
}

/** Change status explicitly; unknown ids and invalid statuses are rejected. */
export function updateThread(state, { id, status, now } = {}) {
  normalizeState(state);
  if (!STATUSES.has(status)) throw new TypeError('status 必须是 active、done 或 dropped');
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('id 必须是非空字符串');
  const updatedAt = timestamp(now);
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`unknown thread id: ${id}`);
  if (state.items[index].status === status) return state;
  const items = state.items.map((item, i) => i === index ? { ...item, status, updatedAt } : item);
  const active = items.filter((item) => item.status === 'active');
  if (active.length > ACTIVE_LIMIT) throw new RangeError('最多只能保留 8 件进行中的小事。');
  const history = items.filter((item) => item.status !== 'active');
  return normalizeState({ ...state, items: [...active, ...history.slice(0, HISTORY_LIMIT)] });
}

/** A short invitation cue; evidence is explicitly not proof of completion. */
export function threadHint(state) {
  normalizeState(state);
  const active = state.items.filter((item) => item.status === 'active');
  if (!active.length) return '';
  const lines = active.map((item) => `- [${item.id}] ${item.text}（${item.sourceDate}；仅关联线索）`);
  return `可继续也可不选的小事，不催促、不把计划当完成：\n${lines.join('\n')}\n明确完成或放下时用 feast_life_thread 的 done/drop，并传 id。`;
}
