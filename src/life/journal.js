/**
 * 手动生活回顾，与日程计划、吃过/做过的保留列表分开保存。
 * 只从调用方当前读取的实际记录选取快照；不调用模型、不推事件、不把计划当事实。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dayIn, hmIn } from '../state.js';
import { readStoredJson, writeStoredJson } from '../storage.js';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const MAX_CARDS = 12;
const MAX_TITLE = 60;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function invalid(message) {
  return Object.assign(new Error(`生活回顾记录无效：${message}`), { status: 400 });
}

// Date.parse 会把 2 月 30 日滚到三月；必须逐字往返检查，且不允许路径片段。
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-')) {
    throw invalid('日期必须是合法的 YYYY-MM-DD');
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw invalid('日期必须是合法的 YYYY-MM-DD');
  }
  return date;
}

function validTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) throw invalid('时区无效');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw invalid('时区无效');
  }
  return timezone;
}

function isTimestamp(at) {
  return Number.isSafeInteger(at) && Math.abs(at) <= 8_640_000_000_000_000;
}

function validTimestamp(at, label) {
  if (!isTimestamp(at)) throw invalid(`${label}必须是有效的毫秒时间戳`);
  return at;
}

function validText(value, label, max, { empty = false } = {}) {
  if (typeof value !== 'string' || CONTROL.test(value)
    || (!empty && !value.trim()) || [...value].length > max) {
    throw invalid(`${label}${empty ? '' : '不能为空且'}必须是最多 ${max} 字的单行文字`);
  }
  return value;
}

function manualTitle(value) {
  // 空白串用于主动清空；超长输入不静默截断。
  if (typeof value !== 'string') throw invalid('手动标题必须是文字');
  validText(value, '手动标题', MAX_TITLE, { empty: true });
  return value.trim();
}

function exactShape(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw invalid(`${label}字段或结构不正确`);
  }
}

function cleanEntry(entry) {
  exactShape(entry, ['id', 'at', 'hm', 'kind', 'text', 'note'], '实际记录');
  const id = validText(entry.id, '实际记录 ID', 128);
  const at = validTimestamp(entry.at, '实际记录时间');
  if (typeof entry.hm !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry.hm)) {
    throw invalid('实际记录时刻必须是 HH:MM');
  }
  if (entry.kind !== 'meal' && entry.kind !== 'activity') throw invalid('实际记录类型无效');
  const text = validText(entry.text, '实际记录内容', 300);
  const note = validText(entry.note, '实际记录备注', 1000, { empty: true });
  if (entry.kind === 'meal' && note !== '尝了一口' && note !== '吃过') {
    throw invalid('饮食记录必须区分尝了一口和吃过');
  }
  return { id, at, hm: entry.hm, kind: entry.kind, text, note };
}

function cleanCard(card) {
  exactShape(card, ['id', 'createdAt', 'title', 'entries'], '纪念卡');
  const id = validText(card.id, '纪念卡 ID', 128);
  const createdAt = validTimestamp(card.createdAt, '纪念卡创建时间');
  const title = validText(card.title, '手动标题', MAX_TITLE, { empty: true });
  if (!Array.isArray(card.entries) || card.entries.length < 1 || card.entries.length > 2) {
    throw invalid('纪念卡必须包含 1–2 条实际记录');
  }
  const entries = [];
  const seen = new Set();
  for (const raw of card.entries) {
    const entry = cleanEntry(raw);
    if (seen.has(entry.id)) throw invalid('纪念卡实际记录 ID 不能重复');
    if (entry.at > createdAt) throw invalid('纪念卡不能包含创建时尚未发生的未来记录');
    seen.add(entry.id);
    entries.push(entry);
  }
  return { id, createdAt, title, entries };
}

/** 严格校验并深拷贝；不补字段、不丢弃坏卡，也不静默裁剪。date 可限定文件所属日期。 */
export function cleanJournal(journal, date = journal?.date) {
  exactShape(journal, ['version', 'date', 'title', 'cards'], '生活回顾');
  validDate(date);
  validDate(journal.date);
  if (journal.version !== 1) throw invalid('不支持的生活回顾版本');
  if (journal.date !== date) throw invalid('文件日期与生活回顾日期不一致');
  const title = validText(journal.title, '手动标题', MAX_TITLE, { empty: true });
  if (!Array.isArray(journal.cards) || journal.cards.length > MAX_CARDS) {
    throw invalid('每天最多保存 12 张纪念卡');
  }
  const cards = [];
  const seen = new Set();
  for (const raw of journal.cards) {
    const card = cleanCard(raw);
    if (seen.has(card.id)) throw invalid('纪念卡 ID 不能重复');
    seen.add(card.id);
    cards.push(card);
  }
  // 卡的固定格式没有时区：读档时不擅自用默认时区重算自定义时区的日期。
  // 所属日期与 hm 的精确校验在 withMemoryCard 中按调用方时区完成。
  return { version: 1, date, title, cards };
}

function sourceText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/gu, ' ').trim();
  return CONTROL.test(text) || [...text].length > max ? '' : text;
}

/**
 * 仅提取 eaten 与 play.done 的事实，严格按指定 date/timezone 过滤。
 * ID = 完整源记录语义的 SHA-256 + 同项重复序号；裁掉无关记录不会改变剩余项的 ID。
 * 完全相同的重复记录无持久身份，只能在当前同项组内区分其序号。
 */
export function actualForDate(eaten, play, date, timezone = DEFAULT_TIMEZONE) {
  validDate(date);
  validTimezone(timezone);
  const actual = [];
  const counts = new Map();
  const add = (kind, source, at, text, note) => {
    if (!isTimestamp(at) || dayIn(timezone, at) !== date) return;
    const hash = createHash('sha256').update(JSON.stringify([kind, at, ...source])).digest('hex');
    const occurrence = (counts.get(hash) ?? 0) + 1;
    counts.set(hash, occurrence);
    actual.push({ id: `${kind}-${hash}-${occurrence}`, at, hm: hmIn(timezone, at), kind, text, note });
  };
  for (const entry of Array.isArray(eaten) ? eaten : []) {
    if (!entry || typeof entry !== 'object') continue;
    const sourceId = sourceText(entry.id, 80);
    const name = sourceText(entry.name, 60);
    if (!sourceId) continue;
    const bite = entry.bite === true;
    add('meal', [sourceId, name, entry.by === 'owner' ? 'owner' : 'self', entry.miss === true, bite],
      entry.at, name || sourceId, bite ? '尝了一口' : '吃过');
  }
  for (const entry of Array.isArray(play?.done) ? play.done : []) {
    if (!entry || typeof entry !== 'object') continue;
    const activity = sourceText(entry.activity, 80);
    const note = sourceText(entry.note ?? '', 300);
    if (!activity || (entry.note && !note)) continue;
    add('activity', [activity, note], entry.at, activity, note);
  }
  // Node 支持稳定排序：同毫秒保持 eaten 原序，再保持 play.done 原序。
  return actual.sort((a, b) => a.at - b.at);
}

/** 日期只用作经过严格校验的文件名，目录固定为 feast/journal。 */
export function journalPath(dataDir, date) {
  return join(dataDir, 'feast', 'journal', `${validDate(date)}.json`);
}

/** 缺失才返回空回顾；损坏（含语义错）抛错，原档不动。 */
export async function readJournal(dataDir, date) {
  const file = journalPath(dataDir, date);
  const raw = await readStoredJson(file);
  if (raw === null) return { version: 1, date, title: '', cards: [] };
  try {
    return cleanJournal(raw, date);
  } catch (err) {
    throw new Error(`生活回顾记录损坏，原文件已保留：${file}（${err.message}）`, { cause: err });
  }
}

/** 先检查旧档的语义，再复用安全存储的原子替换与 .bak；返回保存后的独立副本。 */
export async function writeJournal(dataDir, journal) {
  const saved = cleanJournal(journal);
  const file = journalPath(dataDir, saved.date);
  await readJournal(dataDir, saved.date);
  await mkdir(dirname(file), { recursive: true });
  await writeStoredJson(file, saved);
  return saved;
}

/** 当天手动小标题独立于日程标题。空字符串/空白串可清空。 */
export function withJournalTitle(journal, { title } = {}) {
  const next = cleanJournal(journal);
  next.title = manualTitle(title);
  return next;
}

/**
 * actual 必须由服务端现取 actualForDate(...)，不能信任客户端提交的 actual。
 * 客户端只提交 selectedIds 与手动 title；不接受自由编写的 entries。
 * timezone/nowMs 可注入以严格检查日期和未来事实，默认上海/当前时刻。
 */
export function withMemoryCard(journal, options = {}) {
  const next = cleanJournal(journal);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw invalid('纪念卡参数无效');
  if (Object.hasOwn(options, 'entries')) throw invalid('不能自由编写 entries，请选择现有实际记录');
  if (next.cards.length >= MAX_CARDS) throw invalid('当天已满 12 张纪念卡，请勿继续添加');
  const { selectedIds, actual, timezone = DEFAULT_TIMEZONE, nowMs = Date.now() } = options;
  validTimezone(timezone);
  validTimestamp(nowMs, '当前时间');
  if (next.date > dayIn(timezone, nowMs)) throw invalid('不能为未来日期生成纪念卡');
  if (!Array.isArray(selectedIds) || selectedIds.length < 1 || selectedIds.length > 2) {
    throw invalid('请选择 1–2 条实际记录');
  }
  const selected = new Set();
  for (const id of selectedIds) {
    validText(id, '所选记录 ID', 128);
    if (selected.has(id)) throw invalid('所选记录 ID 不能重复');
    selected.add(id);
  }
  if (!Array.isArray(actual) || actual.length === 0) throw invalid('当前实际记录为空，不能生成纪念卡');
  const available = new Map();
  for (const raw of actual) {
    const entry = cleanEntry(raw);
    if (available.has(entry.id)) throw invalid('当前实际记录 ID 重复，无法安全选择');
    available.set(entry.id, entry);
  }
  const entries = [];
  for (const id of selected) {
    const entry = available.get(id);
    if (!entry) throw invalid('所选 ID 不在当前实际记录中，请重新选择');
    if (entry.at > nowMs) throw invalid('不能选择尚未发生的未来记录');
    if (dayIn(timezone, entry.at) !== next.date) throw invalid('实际记录日期与回顾日期不一致');
    if (hmIn(timezone, entry.at) !== entry.hm) throw invalid('实际记录时刻与指定时区不一致');
    entries.push(entry);
  }
  entries.sort((a, b) => a.at - b.at);
  const id = options.id === undefined ? randomUUID() : validText(options.id, '纪念卡 ID', 128);
  if (next.cards.some((card) => card.id === id)) throw invalid('纪念卡 ID 不能重复');
  const title = manualTitle(options.title === undefined ? '' : options.title);
  next.cards.push({ id, createdAt: nowMs, title, entries });
  return next;
}

/** 返回纯文字，不生成 HTML；显示时应使用 textContent 或纯文本附件。 */
export function memoryCardText(date, card) {
  validDate(date);
  const saved = cleanCard(card);
  return [
    `生活纪念卡 · ${date}`,
    `手动标题：${saved.title || '（未填写）'}`,
    '实际记录：',
    ...saved.entries.map((entry) => `${entry.hm} · ${entry.kind === 'meal' ? '饮食' : '活动'}：${entry.text}${entry.note ? `（${entry.note}）` : ''}`),
  ].join('\n');
}
