/**
 * 味觉渲染的测试：同一道菜每次不一样、同一个"第几次"稳定、温度分类、不合口味的说法。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import { loadDishes } from '../src/dishes.js';
import { renderBite, renderProfile, tempClass } from '../src/eat.js';

const lib = await loadDishes();
const dish = lib.byId.get('mapo-tofu');
const cold = lib.byId.get('tuna-otoro-nigiri');
const drink = lib.byId.get('hand-drip-yirgacheffe');

test('"这一口"带着菜的事实层：名字、口味档案里的描写都在', () => {
  const text = renderBite(dish, { nth: 0, day: '2026-11-05' });
  assert.ok(text.includes('麻婆豆腐'), '缺菜名');
  assert.ok(text.includes('川菜'), '缺菜系');
  assert.ok(text.includes(dish.prose), '缺实吃描写');
  assert.ok(text.includes(dish.texture), '缺口感');
  assert.ok(text.includes(dish.aroma), '缺香气');
  assert.ok(text.includes(dish.finish), '缺余韵');
  assert.ok(text.includes(dish.serving), '缺上桌的样子');
});

test('同一道菜连着吃，说的不是同一句话', () => {
  const a = renderBite(dish, { nth: 0, day: '2026-11-05' });
  const b = renderBite(dish, { nth: 1, day: '2026-11-05' });
  assert.notEqual(a, b, '两次吃一模一样，那是念菜谱');
});

test('同一个"第几次 + 同一天"重放是稳定的', () => {
  const a = renderBite(dish, { nth: 2, day: '2026-11-05' });
  const b = renderBite(dish, { nth: 2, day: '2026-11-05' });
  assert.equal(a, b);
});

test('换一天，同一个"第几次"也会变', () => {
  const a = renderBite(dish, { nth: 0, day: '2026-11-05' });
  const b = renderBite(dish, { nth: 0, day: '2026-11-06' });
  assert.notEqual(a, b);
});

test('吃熟了会多一句"熟悉"的话', () => {
  const first = renderBite(dish, { nth: 0, day: '2026-11-05' });
  const familiar = renderBite(dish, { nth: 5, day: '2026-11-05' });
  assert.ok(familiar.length > first.length);
});

test('温度分类：生鱼是凉的，咖啡是热的', () => {
  assert.equal(tempClass(cold), 'cold', '刺身/寿司该是按凉的处理');
  assert.equal(tempClass(drink), 'warm', '手冲该是按热的处理');
  assert.equal(tempClass(dish), 'hot');
});

test('不合口味时会说清是哪一层不对，并且用这道菜自己的最强维度', () => {
  const text = renderBite(dish, { nth: 0, day: '2026-11-05', miss: true });
  assert.ok(/不太对付|不对付/.test(text), '没说出不合口味');
  // 麻婆豆腐最强的维度是麻（88）
  assert.ok(text.includes('麻'), '没指出是哪一层顶住了');
  assert.ok(!renderBite(dish, { nth: 0, day: '2026-11-05' }).includes('不太对付'));
});

test('饮品不会配白饭', () => {
  const text = renderBite(drink, { nth: 0, day: '2026-11-05', rng: () => 0.0 });
  assert.ok(!text.includes('白饭'), '喝的应该不会配米饭');
});

test('只看不吃的档案：有九维、有食材、有做法，但没有"这一口"', () => {
  const text = renderProfile(dish);
  assert.ok(text.includes('味道：'));
  for (const k of ['辣', '麻', '咸', '鲜', '甜', '酸', '苦', '油', '香']) {
    assert.ok(text.includes(k), `缺维度 ${k}`);
  }
  assert.ok(text.includes(dish.method));
  assert.ok(!text.includes('再喝一口'), '档案里不该混进当下那口');
});

await report();
