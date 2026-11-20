/** 生活预设纯函数测试：只跑本文件，不写配置、不发事件、不启动宿主。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULTS } from '../src/config.js';
import {
  LIFE_PRESETS, LIFE_PRESET_KEYS, lifePresetPreview, assertLifePresetRevision,
} from '../src/life/presets.js';
import { test, report } from './harness.mjs';

const KEYS = [
  'mealReminder', 'mealMaxRetries', 'lifeFreeEnabled', 'lifeFreeSlots',
  'lifeFreeBusyCall', 'lifeMomentEvents', 'lifeFreeAskReport',
];
const DAILY = {
  mealReminder: true,
  mealMaxRetries: 0,
  lifeFreeEnabled: true,
  lifeFreeSlots: '21:00',
  lifeFreeBusyCall: false,
  lifeMomentEvents: false,
  lifeFreeAskReport: false,
};
const TARGETS = {
  quiet: { ...DAILY, lifeFreeEnabled: false },
  daily: { ...DAILY },
  lively: { ...DAILY, lifeFreeSlots: '10:00,14:00,21:00' },
};
const differentValue = (value) => (typeof value === 'boolean' ? !value
  : typeof value === 'number' ? value + 2 : '');
const isInvalidId = (err) => err instanceof RangeError && err.code === 'INVALID_LIFE_PRESET'
  && err.status === 400 && /quiet.*daily.*lively/.test(err.message);
const isStale = (err) => err.code === 'LIFE_PRESET_REVISION_MISMATCH'
  && err.status === 409 && /preview/i.test(err.message);

// 手写预期值，避免直接从实现推导三套预设的正确性。
for (const [id, target] of Object.entries(TARGETS)) {
  test(`${id}：完整目标与实际差量精确匹配，仅含七个白名单键`, () => {
    const item = LIFE_PRESETS.find((entry) => entry.id === id);
    assert.ok(item);
    assert.deepEqual(item.patch, target);
    assert.deepEqual(Object.keys(item.patch), KEYS);
    const cfg = Object.fromEntries(KEYS.map((key) => [key, differentValue(target[key])]));
    const preview = lifePresetPreview(cfg, id);
    assert.equal(preview.id, id);
    assert.deepEqual(preview.patch, target);
    assert.deepEqual(preview.changes, KEYS.map((key) => ({ key, from: cfg[key], to: target[key] })));
    assert.deepEqual(assertLifePresetRevision(cfg, id, preview.revision), target);
  });
}

test('目录：三个固定 ID、七个固定键，均提供中英文 name/description', () => {
  assert.deepEqual(LIFE_PRESET_KEYS, KEYS);
  assert.deepEqual(LIFE_PRESETS.map(({ id }) => id), ['quiet', 'daily', 'lively']);
  for (const item of LIFE_PRESETS) {
    for (const language of ['zh', 'en']) {
      assert.equal(typeof item.labels[language].name, 'string');
      assert.ok(item.labels[language].name.trim());
      assert.equal(typeof item.labels[language].description, 'string');
      assert.ok(item.labels[language].description.trim());
    }
  }
});

test('默认配置：daily 无变化，quiet 只关自由时间，lively 只换三个档位', () => {
  const daily = lifePresetPreview({}, 'daily');
  assert.deepEqual(daily.patch, {});
  assert.deepEqual(daily.changes, []);
  assert.deepEqual(lifePresetPreview({}, 'quiet').changes, [
    { key: 'lifeFreeEnabled', from: true, to: false },
  ]);
  assert.deepEqual(lifePresetPreview({}, 'lively').changes, [
    { key: 'lifeFreeSlots', from: '21:00', to: '10:00,14:00,21:00' },
  ]);
  assert.deepEqual(lifePresetPreview(DEFAULTS, 'daily').patch, {});
});

test('changes 只列真正变化的项，patch 与 changes 一一对应且顺序固定', () => {
  const cfg = { ...DAILY, lifeFreeAskReport: true, mealMaxRetries: 3 };
  const preview = lifePresetPreview(cfg, 'daily');
  assert.deepEqual(preview.changes, [
    { key: 'mealMaxRetries', from: 3, to: 0 },
    { key: 'lifeFreeAskReport', from: true, to: false },
  ]);
  assert.deepEqual(preview.patch, { mealMaxRetries: 0, lifeFreeAskReport: false });
});

test('不碰工作安排、日型、饭点时刻、已有日程、联动、天气和自定义清单', () => {
  const cfg = Object.freeze({
    ...DAILY,
    mealSlots: '08:00,20:00', mealSlotsByHer: false,
    lifeEnabled: false, lifeDayType: 'overtime', lifeGenerateAt: '23:00',
    lifeDoings: '自定义清单', lifeFreeMenu: '保留工具示例', lifeAdjustPast: true,
    lifeFreeFunOn: false, lifeFreeMapOn: false, lifeWardrobeOn: false,
    lifeWardrobeDir: 'custom', lifeWardrobeAutoOutfit: false,
    weatherEnabled: true, weatherCity: '成都',
    workSchedule: Object.freeze({ days: [1, 3, 5] }),
    days: Object.freeze([{ date: '2026-11-19', items: [] }]),
  });
  const before = structuredClone(cfg);
  for (const id of Object.keys(TARGETS)) {
    const preview = lifePresetPreview(cfg, id);
    assert.deepEqual(cfg, before);
    assert.ok(Object.keys(preview.patch).every((key) => KEYS.includes(key)));
    assert.ok(preview.changes.every(({ key }) => KEYS.includes(key)));
    const applied = { ...cfg, ...assertLifePresetRevision(cfg, id, preview.revision) };
    for (const key of Object.keys(cfg).filter((key) => !KEYS.includes(key))) {
      assert.strictEqual(applied[key], cfg[key]);
    }
  }
});

test('预览和校验不突变输入，返回值也不与输入或目录共享可写目标', () => {
  const cfg = Object.freeze({ ...DAILY, mealReminder: false, lifeFreeSlots: '' });
  const before = structuredClone(cfg);
  const preview = lifePresetPreview(cfg, 'lively');
  const patch = assertLifePresetRevision(cfg, 'lively', preview.revision);
  preview.patch.mealReminder = false;
  preview.patch.weatherEnabled = true;
  preview.changes[0].from = '改过的显示内容';
  preview.changes[0].to = false;
  patch.lifeFreeSlots = '00:00';
  assert.deepEqual(cfg, before);
  assert.deepEqual(lifePresetPreview(cfg, 'lively').patch, {
    mealReminder: true, lifeFreeSlots: '10:00,14:00,21:00',
  });
});

test('目录与嵌套目标被冻结，调用方不能篡改后续预设', () => {
  assert.ok(Object.isFrozen(LIFE_PRESETS));
  assert.ok(Object.isFrozen(LIFE_PRESET_KEYS));
  for (const item of LIFE_PRESETS) {
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.patch));
    assert.ok(Object.isFrozen(item.labels));
    assert.ok(Object.isFrozen(item.labels.zh));
    assert.ok(Object.isFrozen(item.labels.en));
  }
  assert.throws(() => { LIFE_PRESETS[0].patch.mealReminder = false; }, TypeError);
  assert.throws(() => { LIFE_PRESETS.push({ id: 'custom' }); }, TypeError);
  assert.throws(() => { LIFE_PRESET_KEYS.push('weatherEnabled'); }, TypeError);
});

test('无效 ID、原型键、对象及任意 patch 输入均明确拒绝', () => {
  for (const id of [
    '', 'missing', 'DAILY', ' daily', 'daily ', '__proto__', 'prototype', 'constructor',
    'toString', 'hasOwnProperty', null, undefined, 0, true, ['daily'], Symbol('daily'),
    { id: 'daily', patch: { weatherEnabled: true } },
    { toString() { throw new Error('不应做类型强转'); } },
  ]) {
    assert.throws(() => lifePresetPreview({}, id), isInvalidId);
    assert.throws(() => assertLifePresetRevision({}, id, ''), isInvalidId);
  }
});

test('不信任配置原型上的白名单键，__proto__/constructor 污染字段不进入结果', () => {
  const inherited = Object.create({
    mealReminder: false, lifeFreeEnabled: false, lifeFreeSlots: '00:00',
    lifeFreeAskReport: true, mealMaxRetries: 9,
  });
  assert.deepEqual(lifePresetPreview(inherited, 'daily'), lifePresetPreview({}, 'daily'));
  const polluted = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"lifeFreeSlots":""}');
  const preview = lifePresetPreview(polluted, 'daily');
  assert.deepEqual(preview.patch, { lifeFreeSlots: '21:00' });
  assert.deepEqual(Object.keys(assertLifePresetRevision(polluted, 'daily', preview.revision)), ['lifeFreeSlots']);
  assert.equal(Object.getPrototypeOf(preview.patch), Object.prototype);
  assert.equal(Object.hasOwn(preview.patch, '__proto__'), false);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('revision 是白名单当前值、ID 与完整目标 patch 的稳定 SHA256', () => {
  const current = Object.fromEntries(KEYS.map((key) => [key, DEFAULTS[key]]));
  for (const [id, patch] of Object.entries(TARGETS)) {
    const preview = lifePresetPreview({}, id);
    const expected = createHash('sha256').update(JSON.stringify({ id, current, patch })).digest('hex');
    assert.match(preview.revision, /^[a-f0-9]{64}$/);
    assert.equal(preview.revision, expected);
    assert.equal(lifePresetPreview({}, id).revision, expected);
  }
  assert.equal(new Set(Object.keys(TARGETS).map((id) => lifePresetPreview({}, id).revision)).size, 3);
});

test('revision 检查所有相关键，包括原先没有差量的键', () => {
  for (const id of Object.keys(TARGETS)) {
    const cfg = { ...TARGETS[id] };
    const before = lifePresetPreview(cfg, id);
    assert.deepEqual(before.changes, []);
    for (const key of KEYS) {
      const changed = { ...cfg, [key]: differentValue(cfg[key]) };
      assert.notEqual(lifePresetPreview(changed, id).revision, before.revision, `${id}: ${key}`);
      assert.throws(() => assertLifePresetRevision(changed, id, before.revision), isStale, `${id}: ${key}`);
    }
  }
});

test('无关键的变化不会使 revision 失效，也不会读取它们的 getter 或循环对象', () => {
  const cfg = { ...DAILY };
  const preview = lifePresetPreview(cfg, 'quiet');
  const unrelated = {
    ...cfg, mealSlots: '', mealSlotsByHer: false, lifeDayType: 'overtime',
    lifeEnabled: false, lifeDoings: '另一张清单', lifeFreeMenu: '',
    lifeFreeFunOn: false, lifeFreeMapOn: false, lifeWardrobeOn: false,
    weatherEnabled: true, weatherCity: '上海', workSchedule: [], days: [],
  };
  unrelated.unknown = unrelated;
  Object.defineProperty(unrelated, 'constructor', { get() { throw new Error('不可读'); } });
  Object.defineProperty(unrelated, 'otherSetting', { get() { throw new Error('不可读'); } });
  assert.equal(lifePresetPreview(unrelated, 'quiet').revision, preview.revision);
  assert.deepEqual(assertLifePresetRevision(unrelated, 'quiet', preview.revision), { lifeFreeEnabled: false });
});

test('缺键按 DEFAULTS，显式默认值和不同插入顺序不改变 revision', () => {
  const reverse = Object.fromEntries([...KEYS].reverse().map((key) => [key, DEFAULTS[key]]));
  for (const id of Object.keys(TARGETS)) {
    const empty = lifePresetPreview({}, id);
    assert.deepEqual(lifePresetPreview(DEFAULTS, id), empty);
    assert.deepEqual(lifePresetPreview(reverse, id), empty);
    assert.deepEqual(lifePresetPreview(undefined, id), empty);
    assert.deepEqual(lifePresetPreview(null, id), empty);
    assert.deepEqual(lifePresetPreview({ lifeFreeSlots: undefined }, id), empty);
    assert.deepEqual(lifePresetPreview(Object.create(null), id), empty);
  }
});

test('false、0、空字符串不被默认值覆盖，前后值可供界面准确预览', () => {
  const cfg = {
    mealReminder: false, mealMaxRetries: 0, lifeFreeEnabled: false, lifeFreeSlots: '',
    lifeFreeBusyCall: false, lifeMomentEvents: false, lifeFreeAskReport: false,
  };
  const preview = lifePresetPreview(cfg, 'daily');
  assert.deepEqual(preview.changes, [
    { key: 'mealReminder', from: false, to: true },
    { key: 'lifeFreeEnabled', from: false, to: true },
    { key: 'lifeFreeSlots', from: '', to: '21:00' },
  ]);
  assert.deepEqual(preview.patch, { mealReminder: true, lifeFreeEnabled: true, lifeFreeSlots: '21:00' });
  assert.equal(preview.changes.some(({ key }) => key === 'mealMaxRetries'), false);
  const retried = lifePresetPreview({ ...cfg, mealMaxRetries: 2 }, 'daily');
  assert.deepEqual(retried.changes.find(({ key }) => key === 'mealMaxRetries'), {
    key: 'mealMaxRetries', from: 2, to: 0,
  });
  assert.notEqual(preview.revision, lifePresetPreview({ ...cfg, lifeFreeSlots: undefined }, 'daily').revision);
});

test('显式 null 不当缺键，确保预览与 revision 不丢失当前值', () => {
  const preview = lifePresetPreview({ lifeFreeSlots: null }, 'daily');
  assert.deepEqual(preview.changes, [{ key: 'lifeFreeSlots', from: null, to: '21:00' }]);
  assert.notEqual(preview.revision, lifePresetPreview({}, 'daily').revision);
});

test('校验拒绝过期、损坏、缺失和跨预设 revision，拒绝时不修改配置', () => {
  const cfg = Object.freeze({ ...DAILY, lifeFreeSlots: '' });
  const before = structuredClone(cfg);
  const quiet = lifePresetPreview(cfg, 'quiet');
  for (const revision of ['', 'bad', undefined, null, 0, { revision: quiet.revision }]) {
    assert.throws(() => assertLifePresetRevision(cfg, 'quiet', revision), isStale);
  }
  assert.throws(() => assertLifePresetRevision(cfg, 'daily', quiet.revision), isStale);
  assert.deepEqual(cfg, before);
});

test('应用校验重新生成可信差量，不采纳调用方改过的预览 patch', () => {
  const cfg = { ...DAILY, lifeFreeSlots: '' };
  const preview = lifePresetPreview(cfg, 'quiet');
  preview.patch.weatherEnabled = true;
  preview.patch.lifeFreeSlots = '00:00';
  delete preview.patch.lifeFreeEnabled;
  assert.deepEqual(assertLifePresetRevision(cfg, 'quiet', preview.revision), {
    lifeFreeEnabled: false, lifeFreeSlots: '21:00',
  });
  assert.equal(cfg.lifeFreeEnabled, true, '校验不应用补丁');
  assert.equal(cfg.lifeFreeSlots, '', '持久化与运行内存更新留给宿主');
});

test('非对象配置明确拒绝', () => {
  for (const cfg of [false, 0, '', [], 'daily']) {
    assert.throws(() => lifePresetPreview(cfg, 'daily'), /configuration must be an object/);
  }
});

await report();
