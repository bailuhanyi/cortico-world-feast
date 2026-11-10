/**
 * 「她的一天」的时间工具。
 *
 * 「今天 / 现在」的时区算法直接复用食时的 state.js（饭点也走它），
 * 免得同一个 World 里两套 Intl formatter 对「今天」理解不一致。
 * 日期是 YYYY-MM-DD 字符串，时刻是当天第几分钟（0–1440）。
 *
 * 纯函数：不碰文件、不碰定时器、不碰宿主。
 */
import { dayIn, hmIn, minutesIn } from '../state.js';

export const WEEKDAY = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 'YYYY-MM-DD' 的星期（0 = 周日）。 */
export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** { date, minute, hm, weekday }，全部按给定时区算。 */
export function zonedNow(tz, now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const date = dayIn(tz, ms);
  return { date, minute: minutesIn(tz, ms), hm: hmIn(tz, ms), weekday: weekdayOf(date) };
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDateKey(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** 'HH:MM' → 分钟；'24:00' → 1440；非法返回 null。 */
export function parseClock(s) {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

export function clock(minute) {
  const m = Math.max(0, Math.min(1440, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dateLabel(date) {
  const [, mo, d] = date.split('-');
  return `${Number(mo)}月${Number(d)}日 ${WEEKDAY[weekdayOf(date)]}`;
}
