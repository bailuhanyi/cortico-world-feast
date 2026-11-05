/**
 * 味觉渲染的测试：同一道菜每次不一样、同一个"第几次"稳定、温度分类、不合口味的说法。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import { loadDishes } from '../src/dishes.js';
import { POOLS, renderBite, renderProfile, tempClass } from '../src/eat.js';

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

test('汤句只说给真有汤的菜：鸡翅、烤肉不会被念「先喝了口汤」', () => {
  // 这句原来躺在 food 池里，于是布法罗鸡翅、烤串、煎饼都会"先喝了口汤"。
  // 现在汤羹/火锅单独一档，food 池里不许再出现汤句。
  const SOUP_ONLY = ['先喝了口汤', '一勺接一勺', '端着碗喝到最后一口', '汤比饭先见底'];
  for (const line of POOLS.WITH.food) {
    for (const s of SOUP_ONLY) {
      assert.ok(!line.includes(s), `food 池里混进了汤句：「${line}」`);
    }
  }
  // 抽几道确定没汤的菜，跑遍档位和日期，一句都不许出现。
  const noSoup = ['buffalo-wings', 'dak-galbi', 'scallion-pancake', 'barbecue-ribs', 'apple-pie'];
  for (const id of noSoup) {
    const d = lib.byId.get(id);
    assert.ok(d, `库里没有 ${id}`);
    for (let nth = 0; nth < 3; nth += 1) {
      for (const day of ['2026-11-01', '2026-11-05', '2026-11-09']) {
        const text = renderBite(d, { nth, day });
        for (const s of SOUP_ONLY) {
          assert.ok(!text.includes(s), `${d.name} 被念出了汤句「${s}」`);
        }
      }
    }
  }
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

test('吃熟了：熟客不再说"第一印象"那套', () => {
  const first = renderBite(dish, { nth: 0, day: '2026-11-05' });
  const familiar = renderBite(dish, { nth: 5, day: '2026-11-05' });
  assert.ok(POOLS.ANGLE[0].some((s) => first.includes(s)), '第一回该是第一次那套');
  assert.ok(POOLS.ANGLE[2].some((s) => familiar.includes(s)), '第五回该是熟客那套');
  // 温度那句话里本来就有"第一口"（刚出锅烫嘴），所以按整句比，不按词比
  assert.ok(!POOLS.ANGLE[0].some((s) => familiar.includes(s)), '吃过五回了还在写第一次那句，那是念稿子');
});

test('换角度：第几次就说第几次那档的话', () => {
  // 档位之间不能互相串（串了就是"第二回还在写第一印象"）
  assert.equal(POOLS.ANGLE.length, 3, '第一回 / 第二回 / 第三回起，三档');
  for (const pool of POOLS.ANGLE) assert.ok(pool.length >= 4, '每档句子太少，同一天连吃两回就会撞');
  assert.ok(POOLS.ANGLE[0].some((s) => /第一口/.test(s)), '第一档该是"第一印象"那套');
  assert.ok(POOLS.ANGLE[1].every((s) => !/第一口|第一次吃/.test(s)), '第二回那档不该再说"第一次"');
  assert.ok(POOLS.ANGLE[2].every((s) => !/第一口|第一次吃/.test(s)), '第三回起那档不该再说"第一次"');

  const day = '2026-11-05';
  const bite = (nth, d = day) => {
    const text = renderBite(dish, { nth, day: d });
    const pool = POOLS.ANGLE[Math.min(nth, 2)];
    const hit = pool.find((s) => text.includes(s));
    assert.ok(hit, `第 ${nth + 1} 回没吃到第 ${Math.min(nth, 2) + 1} 档的话`);
    // 也不能同时吃到别的档位的话
    for (const [i, other] of POOLS.ANGLE.entries()) {
      if (i === Math.min(nth, 2)) continue;
      assert.ok(!other.some((s) => text.includes(s)), `第 ${nth + 1} 回串到了第 ${i + 1} 档`);
    }
    return hit;
  };

  for (const nth of [0, 1, 2, 7]) bite(nth);

  // 同一档里也不能老是同一句：换个日子该挑到另一句
  for (const nth of [0, 1, 2]) {
    assert.notEqual(bite(nth), bite(nth, `${day}-2`), `第 ${nth + 1} 档两句的日子挑到了同一句`);
  }
});

test('温度分类：生鱼是凉的，咖啡是热的', () => {
  assert.equal(tempClass(cold), 'cold', '刺身/寿司该是按凉的处理');
  assert.equal(tempClass(drink), 'warm', '手冲该是按热的处理');
  assert.equal(tempClass(dish), 'hot');
});

test('热的固体甜点不会被说成"喝掉了"', () => {
  // 舒芙蕾、巴克拉瓦、葡式蛋挞、苹果派都是热的，但它们是**用勺子/手吃**的东西。
  // 原来它们落到 warm 那档（句子照饮品写的："放到能入口的温度就喝掉了""杯子握在手里"），
  // 一道舒芙蕾被当成一杯饮料。
  const sweets = ['french-souffle', 'baklava', 'pastel-de-nata', 'apple-pie']
    .map((id) => lib.byId.get(id)).filter(Boolean);
  assert.equal(sweets.length, 4, '甜品样本没找齐');
  for (const d of sweets) {
    assert.equal(tempClass(d), 'warmSweet', `${d.name} 该走"热的固体甜点"那档`);
    for (const nth of [0, 1, 2]) {
      const text = renderBite(d, { nth, day: '2026-11-05' });
      assert.ok(!/喝掉|杯子握在手里|先闻了两口才喝/.test(text),
        `${d.name} 第 ${nth + 1} 回被写成像在喝饮料`);
    }
  }
  // 反过来：真饮品还得走 warm，别被这条修过头。
  assert.equal(tempClass(drink), 'warm');
  assert.ok(/杯|喝/.test(POOLS.TEMP.warm.join('')));
});

test('温度不看"词里恰好带凉字"，只看这道菜本身', () => {
  // 苹果派的关键词写着「配冰淇淋」——那是旁边那球，派本身是烫的。
  assert.equal(tempClass(lib.byId.get('apple-pie')), 'warmSweet', '苹果派被"配冰淇淋"带成了凉的');
  // 官渡粑粑「凉了更韧」、番茄蒜香烤面包「冷番茄」、丝娃娃、奇拉基莱斯「解宿醉」同理。
  for (const id of ['guandu-baba', 'bruschetta-al-pomodoro']) {
    assert.notEqual(tempClass(lib.byId.get(id)), 'cold', `${id} 被别的词带成了凉的`);
  }
  // 但真凉的东西不能被放过：冷藏、冰镇、冷食，以及名字里就有凉的。
  for (const id of ['tiramisu', 'lvdagun', 'mango-shaved-ice', 'creme-brulee']) {
    assert.equal(tempClass(lib.byId.get(id)), 'cold', `${id} 明明是凉的，被漏掉了`);
  }
  // 珍珠奶茶是热的，别因为名字里有"冰"以外的字眼就归到冷。
  assert.equal(tempClass(lib.byId.get('iced-pearl-milk-tea')), 'warm', '奶茶默认该是热的');
});

test('温度档的词库都得有料，缺一档会静默退回 hot', () => {
  for (const [k, pool] of Object.entries(POOLS.TEMP)) {
    assert.ok(Array.isArray(pool) && pool.length >= 3, `${k} 档只有 ${pool?.length ?? 0} 句`);
  }
  // renderBite 里是 TEMP[temp] ?? TEMP.hot，档名写错就会悄悄全说成"刚出锅"。
  assert.ok(POOLS.TEMP.warmSweet, 'warmSweet 档不见了');
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
