/**
 * 套餐（一桌菜）的测试：解析、配菜纪律、口味画像配菜、预设守门。
 *
 * 这一层是纯逻辑（src/combos.js），所以大部分断言不需要起 World。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import { loadDishes, TASTE_FIELDS } from '../src/dishes.js';
import {
  PRESETS, adhocCombo, comboIdFrom, comboProblem, comboSize, findCombo,
  findPreset, lightScore, normalizeCombo, resolveCombo, scoreByTaste, tableLine, tableTaste,
} from '../src/combos.js';

const lib = await loadDishes();

const fake = (id, taste, extra = {}) => ({
  id, name: id, cuisine: extra.cuisine ?? '川菜', category: extra.category ?? '热菜',
  region: '', ingredients: [], method: '', serving: '',
  taste: Object.fromEntries(TASTE_FIELDS.map((k) => [k, taste[k] ?? 0])),
  texture: '', aroma: '', finish: '', prose: '', keywords: extra.keywords ?? [],
});

/** 假的库：id 顺序固定，方便断言。 */
function fakeLib(dishes) {
  return { dishes, byId: new Map(dishes.map((d) => [d.id, d])) };
}

// ---------------------------------------------------------------------------
// 固定桌
// ---------------------------------------------------------------------------

test('固定桌：写死的 id 全都解析出来，顺序不变', () => {
  const a = fake('a', { 辣: 10 }, { category: '热菜' });
  const b = fake('b', { 辣: 20 }, { category: '汤羹' });
  const l = fakeLib([a, b]);
  const { dishes, missing } = resolveCombo(l, { id: 'x', name: 'x', dishes: ['b', 'a'] });
  assert.deepEqual(dishes.map((d) => d.id), ['b', 'a'], '顺序应该照写死的顺序');
  assert.equal(missing.length, 0, '没有缺的');
});

test('固定桌：id 不存在时只丢那一道，其余照常，而且不抛', () => {
  const a = fake('a', {}, { category: '热菜' });
  const l = fakeLib([a]);
  const { dishes, missing } = resolveCombo(l, { name: 'x', dishes: ['a', 'is-gone'] });
  assert.deepEqual(dishes.map((d) => d.id), ['a'], '剩下那道还在');
  assert.equal(missing.length, 1, '缺的要说出来，不能静默');
  assert.ok(missing[0].includes('is-gone'), '要写清是哪一道丢了');
});

test('固定桌：重复 id 只上一次', () => {
  const a = fake('a', {});
  const l = fakeLib([a]);
  const { dishes } = resolveCombo(l, { name: 'x', dishes: ['a', 'a'] });
  assert.equal(dishes.length, 1, '一道菜不该在一桌里出现两次');
});

test('固定桌：被排除的菜（她标记过 dislike）进不了桌', () => {
  const a = fake('a', {});
  const b = fake('b', {});
  const l = fakeLib([a, b]);
  const { dishes } = resolveCombo(l, { name: 'x', dishes: ['a', 'b'] }, { exclude: ['a'] });
  assert.deepEqual(dishes.map((d) => d.id), ['b']);
});

// ---------------------------------------------------------------------------
// 配方桌
// ---------------------------------------------------------------------------

test('配方桌：槽位填满，条数与 count 一致', () => {
  const combo = {
    id: 't', name: 't',
    slots: [
      { label: '两道热菜', count: 2, category: '热菜' },
      { label: '一道汤', count: 1, category: '汤羹' },
    ],
  };
  const { dishes, missing } = resolveCombo(lib, combo, { seed: 's1' });
  assert.equal(missing.length, 0, `不该缺槽：${missing.join('；')}`);
  assert.equal(dishes.length, 3, '2 + 1 = 3 道');
  assert.equal(dishes.filter((d) => d.category === '热菜').length, 2, '热菜两道的类别要对');
  assert.equal(dishes.filter((d) => d.category === '汤羹').length, 1, '汤要一道');
});

test('配方桌：跨槽不重复（同一道不能占两个槽）', () => {
  // 故意让两个槽的范围重叠：都只认「小吃」。
  const combo = {
    id: 't', name: 't',
    slots: [
      { label: '一份小吃', count: 1, category: '小吃' },
      { label: '再来一份小吃', count: 1, category: '小吃' },
    ],
  };
  const { dishes } = resolveCombo(lib, combo, { seed: 's2' });
  assert.equal(dishes.length, 2, '两道都该配出来');
  assert.equal(new Set(dishes.map((d) => d.id)).size, 2, '不能是同一道菜占了两槽');
});

test('配方桌：池子空了跳过那一槽，并说清少配了什么', () => {
  const combo = {
    id: 't', name: 't',
    slots: [
      { label: '一道热菜', count: 1, category: '热菜' },
      { label: '一道月亮', count: 1, category: '月亮' },
    ],
  };
  const { dishes, missing } = resolveCombo(lib, combo, { seed: 's3' });
  assert.equal(dishes.length, 1, '只配上热菜');
  assert.equal(missing.length, 1, '少的那槽要说出来');
  assert.ok(missing[0].includes('一道月亮'), `要写清是哪一槽：${missing[0]}`);
});

test('一整桌都配不出来时不报错，返回空桌', () => {
  const combo = { id: 't', name: 't', slots: [{ label: '一道月亮', count: 1, category: '月亮' }] };
  const { dishes, taste, line } = resolveCombo(lib, combo, { seed: 's4' });
  assert.deepEqual(dishes, []);
  assert.equal(taste, null);
  assert.equal(line, '空的一桌');
});

test('同 seed 同结果；换 seed 换结果', () => {
  const combo = findPreset('four-dishes-soup');
  const a = resolveCombo(lib, combo, { seed: 'same' }).dishes.map((d) => d.id);
  const b = resolveCombo(lib, combo, { seed: 'same' }).dishes.map((d) => d.id);
  assert.deepEqual(a, b, '同一个种子必须配出同一桌（预览和端过去的要一致）');

  // 换若干种子，至少要有一个配得不一样——不然"每次一样"就没必要有种子了。
  const pools = new Set();
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    pools.add(resolveCombo(lib, combo, { seed: s }).dishes.map((d) => d.id).join(','));
  }
  assert.ok(pools.size > 1, '换了种子还是一模一样，说明种子没进到配菜里');
});

test('不传 seed 时用 combo.id 当种子，所以同一天同一桌是稳定的', () => {
  const combo = findPreset('banquet-eight');
  const a = resolveCombo(lib, combo).dishes.map((d) => d.id);
  const b = resolveCombo(lib, combo).dishes.map((d) => d.id);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// 按口味画像配菜
// ---------------------------------------------------------------------------

test('byTaste 配出来的桌，比随机桌更接近口味画像', () => {
  // 造一个很明确的画像：只要辣 90 的菜。
  const avg = Object.fromEntries(TASTE_FIELDS.map((k) => [k, k === '辣' ? 90 : 0]));
  const close = [];
  const far = [];
  for (let i = 0; i < 20; i += 1) {
    close.push(fake(`hot${i}`, { 辣: 88 + (i % 3) }, { category: '热菜' }));
    far.push(fake(`mild${i}`, { 辣: 2 + (i % 3) }, { category: '热菜' }));
  }
  const l = fakeLib([...close, ...far]);
  const combo = { id: 't', name: 't', slots: [{ label: '两道热菜', count: 2, category: '热菜', byTaste: true }] };

  let tasteAvg = 0;
  let randAvg = 0;
  for (const s of ['s1', 's2', 's3', 's4', 's5']) {
    const t = resolveCombo(l, combo, { avg, seed: s }).dishes;
    tasteAvg += t.reduce((a, d) => a + scoreByTaste(d, avg), 0) / t.length;
    const r = resolveCombo(l, { ...combo, slots: [{ ...combo.slots[0], byTaste: false }] }, { avg, seed: s }).dishes;
    randAvg += r.reduce((a, d) => a + scoreByTaste(d, avg), 0) / r.length;
  }
  assert.ok(tasteAvg < randAvg, `按画像配的平均距离应该更小（${tasteAvg} vs ${randAvg}）`);
});

test('按画像配菜不是直接取最相近的前 N 名（那样每次都一样、还挤在同一个味道上）', () => {
  // 20 道菜，辣度 90/89/88… 一路排下去。如果实现是"取前 2 名"，
  // 那么每个种子都会挑出辣 90 和 89 那两道。
  const avg = Object.fromEntries(TASTE_FIELDS.map((k) => [k, k === '辣' ? 90 : 0]));
  const dish = [];
  for (let i = 0; i < 20; i += 1) dish.push(fake(`d${i}`, { 辣: 90 - i }, { category: '热菜' }));
  const l = fakeLib(dish);
  const combo = { id: 't', name: 't', slots: [{ label: '两道热菜', count: 2, category: '热菜', byTaste: true }] };

  const seen = new Set();
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6']) {
    for (const d of resolveCombo(l, combo, { avg, seed: s }).dishes) seen.add(d.id);
  }
  assert.ok(seen.size > 3, `候选池要大于最终取的道数（只见到 ${seen.size} 道，说明是直接取前 N 名）`);
});

test('light 槽挑出来的菜，油+咸+辣 明显低于随机桌', () => {
  const heavy = [];
  const clean = [];
  for (let i = 0; i < 15; i += 1) {
    heavy.push(fake(`h${i}`, { 油: 80, 咸: 70, 辣: 60 }, { category: '热菜' }));
    clean.push(fake(`c${i}`, { 油: 10, 咸: 12, 辣: 0 }, { category: '热菜' }));
  }
  const l = fakeLib([...heavy, ...clean]);
  const combo = { id: 't', name: 't', slots: [{ label: '一道热菜', count: 1, category: '热菜', light: true }] };
  const plain = { id: 't', name: 't', slots: [{ label: '一道热菜', count: 1, category: '热菜' }] };

  const light = resolveCombo(l, combo, { seed: 's1' }).dishes[0];
  let randSum = 0;
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6']) randSum += lightScore(resolveCombo(l, plain, { seed: s }).dishes[0]);
  const randAvg = randSum / 6;
  assert.ok(lightScore(light) < randAvg, `清爽槽该挑更淡的（${lightScore(light)} vs ${randAvg}）`);
});

test('她标记过 dislike 的菜，任何桌都不进（配方桌也一样）', () => {
  const a = fake('a', { 辣: 50 }, { category: '热菜' });
  const b = fake('b', { 辣: 50 }, { category: '热菜' });
  const l = fakeLib([a, b]);
  const combo = { id: 't', name: 't', slots: [{ label: '两道热菜', count: 2, category: '热菜' }] };
  const { dishes, missing } = resolveCombo(l, combo, { exclude: ['a'] });
  assert.deepEqual(dishes.map((d) => d.id), ['b'], '被否掉的不该进桌');
  assert.equal(missing.length, 1, '少配了一道要说出来');
});

test('上一顿吃过的那道降到最后，但不是硬排除', () => {
  // 只剩它一道时，降级不该把它变成"配不出来"。
  const only = fakeLib([fake('a', {})]);
  const one = resolveCombo(only, { id: 't', name: 't', slots: [{ label: '一道热菜', count: 1, category: '热菜' }] }, { demote: 'a' });
  assert.equal(one.dishes.length, 1, '只有一道可选时也要给出来');
  assert.equal(one.missing.length, 0, '这不是"缺了一道"');

  // 有别的可选时，优先给别的。
  const two = fakeLib([fake('a', {}), fake('b', {})]);
  const pick = resolveCombo(two, { id: 't', name: 't', slots: [{ label: '一道热菜', count: 1, category: '热菜' }] }, { demote: 'a' });
  assert.equal(pick.dishes[0].id, 'b', '有别的可选时优先别的');
});

// ---------------------------------------------------------------------------
// 口味签名与说明
// ---------------------------------------------------------------------------

test('一桌的九维平均算得对，空桌是 null', () => {
  const a = fake('a', { 辣: 10, 油: 20 });
  const b = fake('b', { 辣: 30, 油: 40 });
  const t = tableTaste([a, b]);
  assert.equal(t.辣, 20);
  assert.equal(t.油, 30);
  assert.equal(tableTaste([]), null);
  assert.equal(tableTaste(null), null);
});

test('饮品不算进一桌的口味签名（一杯奶茶会把烧烤桌平均成「清爽」）', () => {
  const grill = fake('g', { 辣: 70, 油: 80, 咸: 60 }, { category: '烧烤' });
  const tea = fake('t', { 甜: 60, 油: 0, 咸: 0, 辣: 0 }, { category: '饮品' });
  const t = tableTaste([grill, tea]);
  // 只按菜算：辣 70 油 80 咸 60 → 重口、偏辣。把饮品算进去就成了「中间」。
  assert.equal(t.辣, 70, '饮品的 0 不该把辣的均值拉下去');
  assert.equal(t.油, 80);
  assert.ok(tableLine(t).includes('重口'), `该判成重口：${tableLine(t)}`);
});

test('一桌全是饮品时，饮品仍算得进来（否则没东西可算）', () => {
  const a = fake('a', { 甜: 40 }, { category: '饮品' });
  const b = fake('b', { 甜: 60 }, { category: '饮品' });
  assert.equal(tableTaste([a, b]).甜, 50);
});

test('一桌的话分得出清爽和重口', () => {
  assert.ok(tableLine({ 辣: 10, 油: 20, 咸: 20, 甜: 10, 酸: 10 }).includes('清爽'));
  assert.ok(tableLine({ 辣: 60, 油: 80, 咸: 60 }).includes('重口'));
  assert.ok(tableLine({ 辣: 60, 油: 80, 咸: 60 }).includes('偏辣'));
  assert.equal(tableLine(null), '空的一桌');
});

// ---------------------------------------------------------------------------
// 现配一桌
// ---------------------------------------------------------------------------

test('现配一桌：几道就配几道，2~12 道都撑得住', () => {
  for (const n of [1, 2, 4, 6, 9, 12]) {
    const combo = adhocCombo({ size: n });
    const { dishes } = resolveCombo(lib, combo, { seed: 'x' });
    assert.equal(dishes.length, n, `要 ${n} 道，配出 ${dishes.length} 道`);
    assert.equal(new Set(dishes.map((d) => d.id)).size, n, '不能有重复');
  }
});

test('现配一桌：多要几道时不会全变成热菜', () => {
  const combo = adhocCombo({ size: 8 });
  const { dishes } = resolveCombo(lib, combo, { seed: 'y' });
  const cats = new Set(dishes.map((d) => d.category));
  assert.ok(cats.size >= 4, `八道菜该有至少四种形态，现在只有 ${[...cats].join('/')}`);
});

test('现配一桌：限了菜系就都来自那个菜系', () => {
  const combo = adhocCombo({ size: 4, cuisine: '川菜' });
  const { dishes } = resolveCombo(lib, combo, { seed: 'z' });
  assert.ok(dishes.length >= 2, '川菜 40 道，四道该配得出来');
  assert.ok(dishes.every((d) => d.cuisine === '川菜'), '混进了别的菜系');
});

test('现配一桌：size 写歪了会被夹住，不会配出荒唐的桌', () => {
  for (const [give, want] of [[0, 1], [-5, 1], [999, 12]]) {
    const { dishes } = resolveCombo(lib, adhocCombo({ size: give }), { seed: 'x' });
    assert.equal(dishes.length, want, `size=${give} 应该配 ${want} 道`);
  }
});

// ---------------------------------------------------------------------------
// 预设守门
// ---------------------------------------------------------------------------

test('守门：每个预设的每个字都有名字和说明', () => {
  for (const c of PRESETS) {
    assert.ok(c.id && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id), `预设 id 不是 kebab-case：${c.id}`);
    assert.ok(c.name && c.name.trim(), `${c.id} 缺名字`);
    assert.ok(c.desc && c.desc.trim(), `${c.id} 缺说明`);
    assert.ok(Array.isArray(c.slots) && c.slots.length, `${c.id} 没有槽位`);
    for (const s of c.slots) {
      assert.ok(s.label && s.label.trim(), `${c.id} 有个槽没写 label`);
      assert.ok(Number.isFinite(Number(s.count)) && Number(s.count) >= 1, `${c.id} 的槽 count 不对`);
      const cats = s.categories ?? (s.category ? [s.category] : []);
      assert.ok(cats.length, `${c.id} 的槽既没写 category 也没写 categories`);
    }
  }
});

test('守门：预设 id 不重复', () => {
  const ids = PRESETS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `有重复的预设 id：${ids.join('、')}`);
});

test('守门：预设里的类别都是真类别（写错类别=这一槽永远配不出来）', () => {
  const known = new Set(lib.categories);
  for (const c of PRESETS) {
    for (const s of c.slots) {
      for (const cat of (s.categories ?? [s.category])) {
        assert.ok(known.has(cat), `${c.id} 的「${s.label}」用了不存在的类别：${cat}`);
      }
    }
  }
});

test('守门：预设里写的菜系都是真菜系（写错菜系=这一槽永远配不出来）', () => {
  const known = new Set(lib.cuisines);
  for (const c of PRESETS) {
    for (const s of c.slots) {
      if (!s.cuisine) continue;
      assert.ok(known.has(s.cuisine), `${c.id} 的「${s.label}」用了不存在的菜系：${s.cuisine}`);
    }
  }
});

test('守门：每个预设现在就能配齐，且一道不缺（库里加删菜时这条会红）', () => {
  // 这是最要紧的一条：预设是"槽位现配"，所以某个槽位在整库里凑不出数，
  // 只会在真端上桌的那一刻才暴露。这里提前钉住。
  for (const c of PRESETS) {
    for (const seed of ['s1', 's2', 's3']) {
      const { dishes, missing } = resolveCombo(lib, c, { seed });
      assert.equal(missing.length, 0, `${c.name} 配不齐（seed=${seed}）：${missing.join('；')}`);
      assert.equal(dishes.length, comboSize(c), `${c.name} 应该 ${comboSize(c)} 道`);
      assert.equal(new Set(dishes.map((d) => d.id)).size, dishes.length, `${c.name} 里有重复的菜`);
    }
  }
});

test('守门：预设一律不写死 dish id（写死了库一改名就悄悄失效）', () => {
  for (const c of PRESETS) {
    assert.ok(!c.dishes || !c.dishes.length, `${c.id} 写死了菜 id；预设请用槽位`);
  }
});

test('守门：按画像配的预设，配出来的桌确实比随机配的更贴画像', () => {
  const avg = Object.fromEntries(TASTE_FIELDS.map((k) => [k, k === '辣' ? 70 : 30]));
  const combo = findPreset('by-taste');
  const byProfile = resolveCombo(lib, combo, { avg, seed: 'p' }).dishes;
  const random = resolveCombo(lib, combo, { avg: null, seed: 'p' }).dishes;
  const sum = (ds) => ds.reduce((a, d) => a + scoreByTaste(d, avg), 0) / (ds.length || 1);
  assert.ok(sum(byProfile) < sum(random), '画像桌该更贴画像');
});

test('守门：预设的说明不许承诺库里没有的信息（荤素搭配）', () => {
  // 库里没有可靠的荤素标签（全库带「素」字的只有 2 道），所以"两荤一素"这种说法
  // 配出来可能是四道全荤——那是假话。这条把那个界线钉住。
  const VEG_WORDS = /[两三四五]?荤|素[菜馅]?跟|一荤一素/;
  for (const c of PRESETS) {
    assert.ok(!VEG_WORDS.test(c.desc ?? ''), `${c.name} 的说明承诺了荤素搭配，但库里没有荤素标签：${c.desc}`);
  }
});

test('清爽一餐确实比一桌酒席清爽（按平均 油+咸+辣 断言）', () => {
  const light = resolveCombo(lib, findPreset('light-meal'), { seed: 'q' }).dishes;
  const heavy = resolveCombo(lib, findPreset('banquet-eight'), { seed: 'q' }).dishes;
  const avg = (ds) => ds.reduce((a, d) => a + lightScore(d), 0) / ds.length;
  assert.ok(avg(light) < avg(heavy), `清爽一餐该更淡（${avg(light)} vs ${avg(heavy)}）`);
});

test('同一个菜系的一桌，四道都在那个菜系里', () => {
  for (const id of ['sichuan-table', 'cantonese-table']) {
    const c = findPreset(id);
    const { dishes } = resolveCombo(lib, c, { seed: 'r' });
    assert.equal(dishes.length, 4, `${c.name} 该四道`);
    assert.ok(dishes.every((d) => d.cuisine === c.slots[0].cuisine),
      `${c.name} 里混进了别的菜系：${dishes.map((d) => `${d.name}(${d.cuisine})`).join('、')}`);
  }
});

// ---------------------------------------------------------------------------
// 找套餐 / 自定义套餐的形状
// ---------------------------------------------------------------------------

test('按名字或 id 找预设，认不出来返回 null', () => {
  assert.equal(findPreset('四菜一汤').id, 'four-dishes-soup');
  assert.equal(findPreset('four-dishes-soup').id, 'four-dishes-soup');
  assert.equal(findPreset('夜宵').id, 'late-night');
  assert.equal(findPreset('不存在的桌'), null);
  assert.equal(findPreset(''), null);
});

test('自定义套餐：名字完全一致优先于 id 和模糊匹配', () => {
  const combos = [
    { id: 'a', name: '别的' },
    { id: 'b', name: '四菜一汤' },
  ];
  assert.equal(findCombo(combos, '四菜一汤').id, 'b', '名字一致的优先');
  assert.equal(findCombo(combos, 'a').id, 'a');
  assert.equal(findCombo(combos, '没有的'), null);
});

test('自定义套餐 id 从名字来，撞了会自动加序号', () => {
  assert.equal(comboIdFrom('周末大餐'), 'combo');       // 中文转不出 kebab，退回 combo
  assert.equal(comboIdFrom('Weekend Feast'), 'weekend-feast');
  assert.equal(comboIdFrom('weekend feast', new Set(['weekend-feast'])), 'weekend-feast-2');
  assert.equal(comboIdFrom('  --x--  '), 'x');
});

test('磁盘上的自定义套餐会被补齐，坏的直接丢掉', () => {
  assert.equal(normalizeCombo(null), null);
  assert.equal(normalizeCombo({ name: '   ' }), null, '没名字的丢掉');
  assert.equal(normalizeCombo({ dishes: ['a'] }), null, '没名字的丢掉');
  const c = normalizeCombo({ name: ' 我的桌 ', dishes: ['a', 'a', 'b', '', 1] });
  assert.equal(c.name, '我的桌', '名字两边的空白要剪掉');
  assert.deepEqual(c.dishes, ['a', 'b'], '去重、丢掉非字符串');
  assert.equal(c.kind, 'custom');
});

test('存之前校验：空名、空桌、重复、超量、库外 id 都要拦住', () => {
  assert.ok(comboProblem({ name: '', dishes: ['a'] }, lib).includes('名字'));
  assert.ok(comboProblem({ name: 'x', dishes: [] }, lib).includes('一道菜都没有'));
  assert.ok(comboProblem({ name: 'x', dishes: ['a', 'a'] }, lib).includes('两次'));
  assert.ok(comboProblem({ name: 'x', dishes: Array(13).fill('a') }, lib).includes('最多'));
  assert.ok(comboProblem({ name: 'x', dishes: ['no-such-dish'] }, lib).includes('库里没有'));
  assert.equal(comboProblem({ name: 'x', dishes: ['mapo-tofu'] }, lib), '', '好好的一桌不该报错');
});

test('comboSize 认得两种桌', () => {
  assert.equal(comboSize(findPreset('four-dishes-soup')), 5);
  assert.equal(comboSize(findPreset('banquet-eight')), 8);
  assert.equal(comboSize({ dishes: ['a', 'b', 'c'] }), 3);
});

await report();
