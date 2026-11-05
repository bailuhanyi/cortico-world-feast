/**
 * 菜品库的测试：加载、查找、筛选、随机、口味画像。
 * 不用 node --test（某些受限沙箱里它要 spawn 子进程会被 EPERM 挡住）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, report } from './harness.mjs';
import { loadDishes, findDish, findDishExact, filterDishes, pickFew, pickOne, tasteProfile, TASTE_FIELDS, briefLine } from '../src/dishes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await loadDishes();

test('库里正好 700 道地域菜 + 白米饭 1 道 = 701 道 / 28 个菜系组', () => {
  // 700 是地域菜的契约（中餐 420 + 外餐 280），白米饭是唯一的非地域例外，单独算一道。
  assert.equal(lib.dishes.length, 701, `有 ${lib.dishes.length} 道`);
  assert.equal(lib.cuisines.length, 28, `有 ${lib.cuisines.length} 个菜系`);
});

test('中餐占六成左右（0.5.0 起有意往中餐偏）', () => {
  const cn = ['川菜', '粤菜', '江浙沪菜', '北方菜', '湘菜', '西南菜', '东北菜', '西北菜',
    '闽台菜', '鲁菜', '鄂菜', '徽菜', '赣菜'];
  const cnCount = lib.dishes.filter((d) => cn.includes(d.cuisine)).length;
  const ratio = cnCount / lib.dishes.length;
  assert.ok(ratio >= 0.57 && ratio <= 0.65, `中餐占比 ${ratio.toFixed(2)}，偏离六成太远`);
});

test('每组都不薄：没有哪一组少于 10 道', () => {
  // 组太薄，面板里点进去只有几道菜，等于没有这个菜系。
  const n = {};
  for (const d of lib.dishes) n[d.cuisine] = (n[d.cuisine] ?? 0) + 1;
  for (const [c, v] of Object.entries(n)) {
    if (c === '主食') continue; // 主食是唯一的例外组，见下面那条守门测试
    assert.ok(v >= 10, `「${c}」只有 ${v} 道`);
  }
  assert.equal(Object.keys(n).length, 28, '有菜系没有菜');
});

test('守门：主食组只能有白米饭这一道', () => {
  // 0.6.0 破例开了 staples（cuisine = 主食），理由是白米饭不属于任何一片地方、
  // 写哪个省都是编的。0.4.0 拆掉「家常菜」「甜品」正是因为例外组会越收越多，
  // 变成下一个垃圾场——所以这里把上限钉死，加第二道就直接红。
  // 注意：上限写在 validate-dishes.mjs 的 GROUP_CAPS 里，这里是它的镜像。
  const staple = lib.dishes.filter((d) => d.cuisine === '主食');
  assert.equal(staple.length, 1, `主食组有 ${staple.length} 道，只能是白米饭这一道`);
  assert.equal(staple[0].name, '白米饭');
  assert.equal(staple[0].category, '主食');
  // 反向确认：别的菜系里不许再冒出一个「主食」之外的非地域组名。
  const cnRegions = ['川菜', '粤菜', '江浙沪菜', '北方菜', '湘菜', '西南菜', '东北菜', '西北菜',
    '闽台菜', '鲁菜', '鄂菜', '徽菜', '赣菜'];
  const foreign = ['日料', '韩式', '东南亚', '南亚菜', '墨西哥菜', '意菜', '法餐', '南欧菜',
    '中欧菜', '英美菜', '中东菜', '拉美菜', '东欧菜', '非洲菜'];
  const known = new Set([...cnRegions, ...foreign, '主食']);
  for (const c of lib.cuisines) {
    assert.ok(known.has(c), `出现了没登记在组表里的菜系「${c}」——非地域组不许再开`);
  }
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
  for (const w of ['甜品', '家常菜', '云贵菜', '江浙菜', '印度菜', '欧洲菜']) {
    assert.ok(!lib.cuisines.includes(w), `cuisine 里还留着非地域组「${w}」`);
  }
  // 反向确认：原来在甜品组的菜，现在确实散到别的菜系去了。
  const fromDesserts = lib.dishes.filter((d) => d.category === '甜品');
  assert.ok(fromDesserts.length >= 10, '甜品这个类别本身还在，只是不再占一个菜系');
  assert.ok(new Set(fromDesserts.map((d) => d.cuisine)).size >= 5,
    '甜品类别的菜应该散在至少 5 个菜系里，而不是挤回一个组');
  // 同理「主食」这个非地域组只许有白米饭一道，不许长成第二个甜品组。
  const staple = lib.dishes.filter((d) => d.category === '主食');
  assert.ok(new Set(staple.map((d) => d.cuisine)).size >= 8,
    '主食这个类别应该散在很多菜系里，只有白米饭归在「主食」组');
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

test('0.6.0 新开的徽菜、赣菜都在，且不是只有一两道撑门面', () => {
  for (const c of ['徽菜', '赣菜']) {
    assert.ok(lib.cuisines.includes(c), `缺菜系「${c}」`);
    const list = filterDishes(lib, { cuisine: c });
    assert.ok(list.length >= 20, `「${c}」只有 ${list.length} 道`);
    // region 必须真落在那片地方，不能只是挂个名字。
    const re = c === '徽菜' ? /安徽/ : /江西/;
    const bad = list.filter((d) => !re.test(d.region));
    assert.equal(bad.length, 0, `${c}里这些菜的 region 不在本地：${bad.map((d) => `${d.name}(${d.region})`).join('、')}`);
    // 一个组别全是热菜。
    assert.ok(new Set(list.map((d) => d.category)).size >= 4, `${c}的类别太单一`);
  }
});

test('0.6.0 把欧洲菜拆成南欧菜 + 中欧菜，按地理分', () => {
  // 「欧洲菜」是 0.4.0 从「南欧菜」改名来的临时筐，18 道混着六个国家，再涨就是一锅。
  assert.ok(!lib.cuisines.includes('欧洲菜'), '「欧洲菜」应该已经拆掉');
  const south = filterDishes(lib, { cuisine: '南欧菜' });
  const central = filterDishes(lib, { cuisine: '中欧菜' });
  assert.ok(south.length >= 15, `南欧菜只有 ${south.length} 道`);
  assert.ok(central.length >= 15, `中欧菜只有 ${central.length} 道`);
  // 判据是地理：南欧只有西/葡/希，中欧只有德/奥/比/荷/瑞。
  const S = /西班牙|葡萄牙|希腊|巴斯克|瓦伦西亚|安达卢西亚|加利西亚|加泰|马德里|里斯本|阿连特茹|波尔图|克里特|塞戈维亚/;
  const C = /德国|奥地利|比利时|荷兰|瑞士|慕尼黑|纽伦堡|维也纳|布鲁塞尔|巴伐利亚|豪达|纳沙泰尔|伯尔尼|黑森林/;
  const wrongSouth = south.filter((d) => !S.test(d.region));
  const wrongCentral = central.filter((d) => !C.test(d.region));
  assert.equal(wrongSouth.length, 0, `南欧菜里混进了非南欧：${wrongSouth.map((d) => `${d.name}(${d.region})`).join('、')}`);
  assert.equal(wrongCentral.length, 0, `中欧菜里混进了非中欧：${wrongCentral.map((d) => `${d.name}(${d.region})`).join('、')}`);
  // 意菜、法餐各自成组，没被并进这两个。
  const italianNames = filterDishes(lib, { cuisine: '意菜' }).map((d) => d.region).join(' ');
  assert.ok(/意大利|罗马|米兰|那不勒斯|托斯卡纳/.test(italianNames), '意菜的 region 应该都还在意大利');
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

test('精确找菜（findDishExact）：只认 id / 全名 / 别名，名字的一部分不算', () => {
  assert.equal(findDishExact(lib, 'mapo-tofu')?.name, '麻婆豆腐');
  assert.equal(findDishExact(lib, '  麻婆豆腐  ')?.id, 'mapo-tofu', '两头空白该放过');
  const some = lib.dishes.find((d) => d.alias);
  assert.equal(findDishExact(lib, some.alias)?.id, some.id, '别名不分大小写');
  assert.equal(findDishExact(lib, '绝无此菜xyz'), null);

  // 关键差别：模糊匹配（findDish）会认名字的一部分，精确匹配不认。
  // 主人写"在啃面包"时把「番茄蒜香烤面包」端上去，就是替他编（不变式 6）。
  const fuzzy = lib.dishes.find((d) => d.name.includes('面包'));
  assert.ok(fuzzy, '库里该有带「面包」的菜，否则这条测不出区别');
  assert.equal(findDishExact(lib, '面包'), null, '名字的一部分不算命中');
  assert.ok(findDish(lib, '面包'), '（对照）模糊匹配会猜一个出来');
  assert.equal(findDishExact(lib, '在啃面包'), null);
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
