/**
 * 生活设置预设：只计算七项设置的预览与差量，不写配置、不改运行内存、不推事件。
 *
 * 文案契约：preset.labels.zh / preset.labels.en 均为 { name, description }。
 * preset.patch 是完整七键目标；lifePresetPreview().patch 是实际变化的差量。
 * 宿主应用时重新验证 revision，先 await persist(patch) 成功，再更新运行内存。
 */
import { createHash } from 'node:crypto';
import { DEFAULTS } from '../config.js';

/** 唯一允许预设读取、修改及纳入并发校验的配置键，顺序也是预览的显示顺序。 */
export const LIFE_PRESET_KEYS = Object.freeze([
  'mealReminder',
  'mealMaxRetries',
  'lifeFreeEnabled',
  'lifeFreeSlots',
  'lifeFreeBusyCall',
  'lifeMomentEvents',
  'lifeFreeAskReport',
]);

function preset(id, zh, en, freeEnabled, slots = '21:00') {
  return Object.freeze({
    id,
    labels: Object.freeze({
      zh: Object.freeze(zh),
      en: Object.freeze(en),
    }),
    patch: Object.freeze({
      mealReminder: true,
      mealMaxRetries: 0,
      lifeFreeEnabled: freeEnabled,
      lifeFreeSlots: slots,
      lifeFreeBusyCall: false,
      lifeMomentEvents: false,
      lifeFreeAskReport: false,
    }),
  });
}

export const LIFE_PRESETS = Object.freeze([
  preset('quiet',
    { name: '安静', description: '保留饭点提醒，不重复催饭；关闭自由时间提醒，保留 21:00 档位。忙时呼叫、时段事件和事后报备均关闭。' },
    { name: 'Quiet', description: 'Keep meal reminders without retries. Disable free-time reminders, retaining the 21:00 slot. Busy calls, moment events, and follow-up reports stay off.' },
    false),
  preset('daily',
    { name: '日常', description: '保留饭点提醒，不重复催饭；每天 21:00 提醒自由时间。忙时呼叫、时段事件和事后报备均关闭。' },
    { name: 'Daily', description: 'Keep meal reminders without retries, with one free-time reminder at 21:00. Busy calls, moment events, and follow-up reports stay off.' },
    true),
  preset('lively',
    { name: '活跃', description: '保留饭点提醒，不重复催饭；每天 10:00、14:00、21:00 提醒自由时间。忙时呼叫、时段事件和事后报备均关闭。' },
    { name: 'Lively', description: 'Keep meal reminders without retries, with free-time reminders at 10:00, 14:00, and 21:00. Busy calls, moment events, and follow-up reports stay off.' },
    true, '10:00,14:00,21:00'),
]);

function findPreset(id) {
  // 精确匹配字符串，不按用户输入索引对象，避免 __proto__ / constructor 等原型键。
  const selected = typeof id === 'string' && LIFE_PRESETS.find((item) => item.id === id);
  if (!selected) {
    const error = new RangeError('Invalid life preset id. Expected one of: quiet, daily, lively.');
    error.code = 'INVALID_LIFE_PRESET';
    error.status = 400;
    throw error;
  }
  return selected;
}

function currentSettings(cfg) {
  const source = cfg ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Life preset configuration must be an object.');
  }
  return Object.fromEntries(LIFE_PRESET_KEYS.map((key) => {
    // 只读自有白名单键；缺键/undefined 按默认值解释，false、0、空串和 null 原样保留。
    const value = Object.hasOwn(source, key) ? source[key] : undefined;
    return [key, value === undefined ? DEFAULTS[key] : value];
  }));
}

/**
 * @param {object} cfg 当前 worlds.feast 配置，不需要预先合并 DEFAULTS。
 * @param {'quiet'|'daily'|'lively'} id 只接受内置预设 ID，不接受调用方 patch。
 * @returns {{id: string, patch: object, changes: {key: string, from: *, to: *}[], revision: string}}
 * revision 是固定键序的 { id, current, patch: 完整目标 } 的 SHA256 十六进制值。
 * 即使某个白名单键在本次预览中不变，它之后发生变化也会使 revision 失效。
 */
export function lifePresetPreview(cfg, id) {
  const selected = findPreset(id);
  const current = currentSettings(cfg);
  const changes = LIFE_PRESET_KEYS
    .filter((key) => current[key] !== selected.patch[key])
    .map((key) => ({ key, from: current[key], to: selected.patch[key] }));
  const patch = Object.fromEntries(changes.map(({ key, to }) => [key, to]));
  const revision = createHash('sha256')
    .update(JSON.stringify({ id: selected.id, current, patch: selected.patch }))
    .digest('hex');
  return { id: selected.id, patch, changes, revision };
}

/**
 * 应用前用最新配置重算；校验成功只返回可信的白名单差量，不执行任何写入。
 * revision 用于检测预览后的配置变化，不是授权令牌。宿主仍须串行处理校验和持久化。
 */
export function assertLifePresetRevision(cfg, id, revision) {
  const preview = lifePresetPreview(cfg, id);
  if (typeof revision !== 'string' || revision !== preview.revision) {
    const error = new Error('Life preset preview is stale or invalid. Preview again before applying.');
    error.code = 'LIFE_PRESET_REVISION_MISMATCH';
    error.status = 409;
    throw error;
  }
  return preview.patch;
}
