/**
 * 菜品库的测试：加载、查找、筛选、随机、口味画像。
 * 不用 node --test（某些受限沙箱里它要 spawn 子进程会被 EPERM 挡住）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, report } from './harness.mjs';
import { loadDishes, findDish, filterDishes, pickFew, pickOne, tasteProfile, TASTE_FIELDS, briefLine } from '../src/dishes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await loadDishes();

test('库里正好 500 道菜、24 个菜系组', () => {
  assert.equal(lib.dishes.length, 500, `有 ${lib.dishes.length} 道`);
  assert.equal(lib.cuisines.length, 24, `有 ${lib.cuisines.length} 个菜系`);
});

test('中餐占六成左右（0.5.0 有意往中餐偏）', () => {
  const cn = ['川菜', '粤菜', '江浙沪菜', '北方菜', '湘菜', '西南菜', '东北菜', '西北菜',
    '闽台菜', '鲁菜', '鄂菜'];
  const cnCount = lib.dishes.filter((d) => cn.includes(d.cuisine)).length;
  const ratio = cnCount / lib.dishes.length;
  assert.ok(ratio >= 0.55 && ratio <= 0.65, `中餐占比 ${ratio.toFixed(2)}，偏离六成太远`);
});

test('每组都不薄：没有哪一组少于 10 道', () => {
  // 组太薄，面板里点进去只有几道菜，等于没有这个菜系。
  const n = {};
  for (const d of lib.dishes) n[d.cuisine] = (n[d.cuisine] ?? 0) + 1;
  for (const [c, v] of Object.entries(n)) {
    assert.ok(v >= 10, `「${c}」只有 ${v} 道`);
  }
  assert.equal(Object.keys(n).length, 24, '有菜系没有菜');
});

test('形态组已经解散：cuisine 里不该再出现「汤羹/面点主食/中式小吃」这类形态名', () => {
  const formWords = ['汤羹', '面点主食', '中式小吃', '冰品与冷饮', '饮品', '烧烤与夜市',
    '西餐', '韩式与泰式', '越南与东南亚', '清真菜', '日料·寿司', '日料·热食'];
  for (const w of formWords) {
    assert.ok(!lib.cuisines.includes(w), `cuisine 里还留着形态组「${w}」`);
  }
});

test('库里一个非地域组都不剩：没有甜品、也没有家常菜', () => {
  // 「甜品」在 category 里已经有一个同名值，菜系里再放一个就是同一根轴出现两次；
  // 「家常菜」是风格不是地域。两个都拆了，菜按 region 各归各家。
  // 「印度菜」0.5.0 改名「南亚菜」（要收巴基斯坦、斯里兰卡、孟加拉）。
  for (const w of ['甜品', '家常菜', '南欧菜', '云贵菜', '江浙菜', '印度菜']) {
    assert.ok(!lib.cuisines.includes(w), `cuisine 里还留着非地域组「${w}」`);
  }
  // 反向确认：原来在甜品组的菜，现在确实散到别的菜系去了。
  const fromDesserts = lib.dishes.filter((d) => d.category === '甜品');
  assert.ok(fromDesserts.length >= 10, '甜品这个类别本身还在，只是不再占一个菜系');
  assert.ok(new Set(fromDesserts.map((d) => d.cuisine)).size >= 5,
    '甜品类别的菜应该散在至少 5 个菜系里，而不是挤回一个组');
});

test('0.5.0 新开的三个外餐组都在，而且各自有菜', () => {
  for (const c of ['拉美菜', '东欧菜', '非洲菜']) {
    assert.ok(lib.cuisines.includes(c), `缺菜系「${c}」`);
    assert.ok(filterDishes(lib, { cuisine: c }).length >= 10, `「${c}」菜太少`);
  }
  // 南亚菜改名后，原来印度那批还在，而且多了别国的。
  const sa = filterDishes(lib, { cuisine: '南亚菜' });
  assert.ok(sa.length >= 12, `南亚菜只有 ${sa.length} 道`);
  assert.ok(/巴基斯坦|斯里兰卡|孟加拉/.test(sa.map((d) => d.region).join(' ')),
    '南亚菜里应该出现印度以外的国家，否则改名没意义');
});

test('每个类别下面都能报出它自己有哪些菜系', () => {
  const cc = lib.categoryCuisines;
  assert.ok(cc && typeof cc === 'object', '缺 categoryCuisines');
  assert.deepEqual(Object.keys(cc).sort(), lib.categories.slice().sort());
  for (const [cat, list] of Object.entries(cc)) {
    assert.ok(Array.isArray(list) && list.length > 0, `${cat} 下面没有菜系`);
    for (const c of list) {
      assert.ok(lib.cuisines.includes(c), `${cat} 里报了不存在的菜系 ${c}`);
      assert.ok(filterDishes(lib, { category: cat, cuisine: c }).length > 0,
        `按 ${cat} + ${c} 筛出来是空的，选项就不该给`);
    }
  }
});

test('每道菜的 region 都是个具体地方，不许写「中国」这类空话', () => {
  // 拆掉家常菜的前提就是这条：没有具体 region 的菜，无处可归。
  // 所以「中国」「夏夜路边」「北方人家」这类等于没写的值一律不许再出现。
  const VAGUE = ['中国', '夏夜路边', '北方人家', '家里', '街边', '夜市'];
  for (const d of lib.dishes) {
    const r = (d.region ?? '').trim();
    assert.ok(r.length > 0, `${d.id} 没有 region`);
    for (const v of VAGUE) {
      assert.notEqual(r, v, `${d.id} 的 region 还是空话「${r}」，先补成具体地方`);
    }
    assert.ok(r.length >= 2, `${d.id} 的 region「${r}」太短，看不出是哪`);
  }
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

test('测试里不许写死单个菜系的道数', () => {
  // 0.5.0 从 305 加到 500，一次改了 8 处写死的数字，还有一个「12 道川菜」藏在
  // 面板测试的 waitFor 里，改完数据才红。菜还会继续加，所以单个菜系/筛选结果的
  // 道数一律从库里算。**总数例外**——总库有多少道本来就该写死，那是契约。
  const files = ['dishes', 'eat', 'state', 'world', 'panels'];
  const BAD = [/找到 \d+ 道/, /筛出 \d+ 道/, /\.length === \d{2,}/, /\.length,\s*\d{2,}/];
  for (const name of files) {
    const lines = readFileSync(join(HERE, `${name}.test.mjs`), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/lib\.(dishes|cuisines)\.length|Object\.keys\(n\)\.length/.test(line)) return; // 总数写死是允许的
      for (const re of BAD) {
        if (re.test(line)) assert.fail(`${name}.test.mjs:${i + 1} 写死了数：${line.trim()}`);
      }
    });
  }
});

await report();
