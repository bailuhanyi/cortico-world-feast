/**
 * 菜品库的测试：加载、查找、筛选、随机、口味画像。
 * 不用 node --test（某些受限沙箱里它要 spawn 子进程会被 EPERM 挡住）。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import { loadDishes, findDish, filterDishes, pickFew, pickOne, tasteProfile, TASTE_FIELDS, briefLine } from '../src/dishes.js';

const lib = await loadDishes();

test('库里至少有 70 道菜、15 个菜系', () => {
  assert.ok(lib.dishes.length >= 70, `只有 ${lib.dishes.length} 道`);
  assert.ok(lib.cuisines.length >= 15, `只有 ${lib.cuisines.length} 个菜系`);
});

test('中餐和非中餐各占一半左右', () => {
  const cn = ['川菜', '粤菜', '江浙菜', '北方菜', '湘菜', '云贵菜', '东北菜', '面点主食', '汤羹', '中式小吃'];
  const cnCount = lib.dishes.filter((d) => cn.includes(d.cuisine)).length;
  const ratio = cnCount / lib.dishes.length;
  assert.ok(ratio > 0.4 && ratio < 0.6, `中餐占比 ${ratio.toFixed(2)}，偏离一半太远`);
});

test('每道菜的九维都在 0-100 且是整数', () => {
  for (const d of lib.dishes) {
    for (const k of TASTE_FIELDS) {
      const v = d.taste[k];
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${d.id}.${k}=${v}`);
    }
  }
});

test('每道菜都有 prose / texture / aroma / finish', () => {
  for (const d of lib.dishes) {
    assert.ok(d.prose.length >= 40, `${d.id} prose 太短`);
    assert.ok(d.texture.length > 0, `${d.id} 缺 texture`);
    assert.ok(d.aroma.length > 0, `${d.id} 缺 aroma`);
    assert.ok(d.finish.length > 0, `${d.id} 缺 finish`);
  }
});

test('菜品不是千篇一律：分值有真实的分散', () => {
  const spread = new Set(lib.dishes.map((d) => d.taste.辣));
  assert.ok(spread.size >= 12, `辣的取值只有 ${spread.size} 种，太平了`);
  const zeroSpicy = lib.dishes.filter((d) => d.taste.辣 <= 10).length;
  assert.ok(zeroSpicy >= 12, `不辣的菜只有 ${zeroSpicy} 道，菜谱不像真的`);
});

test('找菜：id、全名、别名都能命中', () => {
  const byId = findDish(lib, 'mapo-tofu');
  assert.equal(byId?.name, '麻婆豆腐');
  const byName = findDish(lib, '麻婆豆腐');
  assert.equal(byName?.id, 'mapo-tofu');
  const some = lib.dishes.find((d) => d.alias);
  const byAlias = findDish(lib, some.alias);
  assert.equal(byAlias?.id, some.id);
  assert.equal(findDish(lib, '  麻婆豆腐  ')?.id, 'mapo-tofu');
  assert.equal(findDish(lib, '绝无此菜xyz'), null);
});

test('筛选：菜系 / 类别 / 标签 / 自由词', () => {
  const chuan = filterDishes(lib, { cuisine: '川菜' });
  assert.ok(chuan.length >= 4 && chuan.every((d) => d.cuisine === '川菜'));
  const desserts = filterDishes(lib, { category: '甜品' });
  assert.ok(desserts.length >= 4 && desserts.every((d) => d.category === '甜品'));
  const byTag = filterDishes(lib, { keyword: '解腻' });
  assert.ok(byTag.every((d) => d.keywords.some((k) => k.includes('解腻'))));
  const byQuery = filterDishes(lib, { query: '花椒' });
  assert.ok(byQuery.length >= 1, '搜花椒应该有结果');
  assert.equal(filterDishes(lib, {}).length, lib.dishes.length);
});

test('随机挑菜：不重复、会避开指定的那道', () => {
  const picks = pickFew(lib, 5, { rng: () => 0.42 });
  assert.equal(picks.length, 5);
  assert.equal(new Set(picks.map((d) => d.id)).size, 5);
  for (let i = 0; i < 20; i += 1) {
    const one = pickOne(lib, { rng: () => i / 40, avoidId: 'mapo-tofu' });
    assert.notEqual(one?.id, 'mapo-tofu', '避开的菜还是被抽中了');
  }
});

test('只在筛选池里随机', () => {
  const pool = filterDishes(lib, { cuisine: '粤菜' });
  for (let i = 0; i < 10; i += 1) {
    const one = pickOne(lib, { rng: () => i / 20, pool });
    assert.equal(one.cuisine, '粤菜');
  }
});

test('菜单一行简介不剧透 prose', () => {
  const d = lib.byId.get('mapo-tofu');
  const line = briefLine(d);
  assert.ok(line.includes('麻婆豆腐'));
  assert.ok(line.includes('川菜'));
  assert.ok(!line.includes(d.prose), '简介里不该出现整段实吃描写');
});

test('口味画像：没吃过是空的，吃过之后算得出均值', () => {
  const empty = tasteProfile(lib, { counts: {}, reactions: [] });
  assert.equal(empty.empty, true);
  assert.equal(empty.avg, null);

  const mapo = lib.byId.get('mapo-tofu');
  const profile = tasteProfile(lib, { counts: { 'mapo-tofu': 2 }, reactions: [{ id: 'mapo-tofu', name: '麻婆豆腐', liked: true, note: '麻得正好' }] });
  assert.equal(profile.empty, false);
  assert.equal(profile.avg.麻, mapo.taste.麻);
  assert.equal(profile.total, 2);
  assert.equal(profile.topCuisine, '川菜');
  assert.ok(profile.likes.includes('麻婆豆腐'));
});

test('口味画像：同一道菜最多按 3 次计入，不会把画像带跑', () => {
  const many = tasteProfile(lib, { counts: { 'mapo-tofu': 40 } });
  assert.equal(many.total, 3);
});

test('坏数据不会放进来（id 重复 / 缺字段的都被跳过）', () => {
  const ids = lib.dishes.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of lib.dishes) {
    assert.ok(d.id && d.name && d.cuisine && d.category);
    assert.ok(Array.isArray(d.ingredients) && Array.isArray(d.keywords));
  }
});

await report();
