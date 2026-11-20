/**
 * 菜品库的测试：加载、查找、筛选、随机、口味画像。
 * 不用 node --test（某些受限沙箱里它要 spawn 子进程会被 EPERM 挡住）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, report } from './harness.mjs';
import { loadDishes, findDish, findDishExact, filterDishes, filterMenuDishes, recommendMenuDishes, pickFew, pickOne, tasteProfile, TASTE_FIELDS, briefLine, CATEGORIES } from '../src/dishes.js';
import { GROUP_CAPS } from '../tools/validate-dishes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await loadDishes();

test('库里正好 799 道地域菜 + 特别餐食 25 道 = 824 道 / 28 个菜系组', () => {
  // 799 是地域菜的总量（0.6.2 补到 700，再补 99 道饮品甜品到 799）。特别餐食是唯一的非地域组：
  // 白米饭 1 道 + 0.7.3 后加的肯德基/麦当劳/汉堡王/海底捞各 6 道 = 25 道，单独算。
  assert.equal(lib.dishes.length, 824, `有 ${lib.dishes.length} 道`);
  assert.equal(lib.cuisines.length, 28, `有 ${lib.cuisines.length} 个菜系`);
});

test('中餐占六成左右（0.5.0 起有意往中餐偏）', () => {
  const cn = ['川菜', '粤菜', '江浙沪菜', '北方菜', '湘菜', '西南菜', '东北菜', '西北菜',
    '闽台菜', '鲁菜', '鄂菜', '徽菜', '赣菜'];
  const cnCount = lib.dishes.filter((d) => cn.includes(d.cuisine)).length;
  // 分母只算地域菜：特别餐食（白米饭 + 四家连锁）不是地域组，算进分母会把中餐比例稀释掉，
  // 那测的就不是「地域菜里中餐占多少」了。
  const regional = lib.dishes.filter((d) => d.cuisine !== '特别餐食').length;
  const ratio = cnCount / regional;
  assert.ok(ratio >= 0.57 && ratio <= 0.65, `地域菜里中餐占比 ${ratio.toFixed(2)}，偏离六成太远`);
});

test('每组都不薄：没有哪一组少于 10 道', () => {
  // 组太薄，面板里点进去只有几道菜，等于没有这个菜系。
  const n = {};
  for (const d of lib.dishes) n[d.cuisine] = (n[d.cuisine] ?? 0) + 1;
  for (const [c, v] of Object.entries(n)) {
    if (c === '特别餐食') continue; // 特别餐食是唯一的例外组，见下面那条守门测试
    assert.ok(v >= 10, `「${c}」只有 ${v} 道`);
  }
  assert.equal(Object.keys(n).length, 28, '有菜系没有菜');
});

test('守门：特别餐食组 = 白米饭 1 道 + 四家连锁各 6 道 = 25 道', () => {
  // 0.6.0 破例开了 staples（当时 cuisine = 主食，0.6.2 改名白饭），理由是白米饭不属于任何一片地方、
  // 写哪个省都是编的。0.4.0 拆掉「家常菜」「甜品」正是因为例外组会越收越多，
  // 变成下一个垃圾场——所以这里把上限钉死，加一道就越线。
  // 2026-11 用户明确要求：这一组改名「特别餐食」，收肯德基/麦当劳/汉堡王/海底捞各 6 道，
  // 它不再只是「一碗饭」，但仍然是**唯一**允许的非地域组。
  // 上限写在 validate-dishes.mjs 的 GROUP_CAPS 里，这里直接 import 当镜像，不抄数字。
  const list = lib.dishes.filter((d) => d.cuisine === '特别餐食');
  assert.equal(list.length, GROUP_CAPS.staples,
    `特别餐食组有 ${list.length} 道，上限是 ${GROUP_CAPS.staples} 道`);
  // 上限的构成：白米饭 1 + 四家各 6。
  assert.equal(GROUP_CAPS.staples, 1 + 4 * 6, '上限应该是白米饭 + 四家连锁各 6 道');
  // 白米饭还在，id 和 category 都没动（只改了 cuisine）。
  const rice = lib.byId.get('white-rice');
  assert.ok(rice, '白米饭那一碗被弄丢了');
  assert.equal(rice.name, '白米饭');
  assert.equal(rice.cuisine, '特别餐食');
  assert.equal(rice.category, '主食');
  // 四家各 6 道，按 id 前缀数：名字会改，前缀是这份数据自己的契约。
  const brands = { 'kfc-': '肯德基', 'mcd-': '麦当劳', 'bk-': '汉堡王', 'hdl-': '海底捞' };
  for (const [prefix, brand] of Object.entries(brands)) {
    const n = list.filter((d) => d.id.startsWith(prefix)).length;
    assert.equal(n, 6, `${brand}应该是 6 道，现在 ${n} 道`);
  }
  // 反向确认：别的菜系里不许再冒出一个「特别餐食」之外的非地域组名。
  const cnRegions = ['川菜', '粤菜', '江浙沪菜', '北方菜', '湘菜', '西南菜', '东北菜', '西北菜',
    '闽台菜', '鲁菜', '鄂菜', '徽菜', '赣菜'];
  const foreign = ['日料', '韩式', '东南亚', '南亚菜', '墨西哥菜', '意菜', '法餐', '南欧菜',
    '中欧菜', '英美菜', '中东菜', '拉美菜', '东欧菜', '非洲菜'];
  const known = new Set([...cnRegions, ...foreign, '特别餐食']);
  for (const c of lib.cuisines) {
    assert.ok(known.has(c), `出现了没登记在组表里的菜系「${c}」——非地域组不许再开`);
  }
});

test('守门：菜系名不许和 category 的形态名撞名', () => {
  // 0.6.0 的 staples 曾叫「主食」，于是面板卡片印出「主食·主食」，菜系下拉和类别下拉
  // 各有一项叫「主食」——同一根轴出现两次。0.4.0 拆「甜品」组就是这个理由。
  // 0.6.2 改成「白饭」，2026-11 又改成「特别餐食」（那一组装进了四家连锁，「白饭」名不副实）。
  // 不论叫什么，都钉住：任何一个菜系名都不许等于某个 category。
  for (const c of lib.cuisines) {
    assert.ok(!CATEGORIES.includes(c),
      `菜系「${c}」和 category 的形态名撞名——菜系只说地域/身份，形态只走 category`);
  }
  // 这条守门是可证的：把 staples.json 的 cuisine 改回「主食」，它（和 validate-dishes）立刻红。
});

test('形态组已经解散：cuisine 里不该再出现「汤羹/面点主食/中式小吃」这类形态名', () => {
  const formWords = ['汤羹', '面点主食', '中式小吃', '冰品与冷饮', '饮品', '烧烤与夜市',
    '西餐', '韩式与泰式', '越南与东南亚', '清真菜', '日料·寿司', '日料·热食'];
  for (const w of formWords) {
    assert.ok(!lib.cuisines.includes(w), `cuisine 里还留着形态组「${w}」`);
  }
});

test('除了特别餐食，不许再冒非地域组：没有甜品、也没有家常菜', () => {
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
  // 同理「特别餐食」这个非地域组只装白米饭和四家连锁的菜，不许长成第二个甜品组。
  const staple = lib.dishes.filter((d) => d.category === '主食');
  assert.ok(new Set(staple.map((d) => d.cuisine)).size >= 8,
    '主食这个类别应该散在很多菜系里，只有白米饭和连锁的堡/卷归在「特别餐食」组');
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

const MENU_NOW = Date.UTC(2026, 10, 19, 12);
const MENU_DAY = 24 * 3600_000;

// 菜单规则用小库固定边界，避免绑在真实菜系的道数或数据顺序上。
function menuLibrary(...ids) {
  const dishes = ids.map((id) => ({
    ...lib.dishes[0], id, name: id, alias: '', cuisine: '川菜', category: '热菜',
    region: '四川', keywords: ['清香'], ingredients: ['花椒'], taste: { ...lib.dishes[0].taste },
  }));
  return { dishes, byId: new Map(dishes.map((d) => [d.id, d])) };
}

const menuIds = (dishes) => dishes.map((d) => d.id);

test('菜单喜欢：最新有效反馈决定喜欢，撤销、厌恶反转与坏反馈均沿用画像规则', () => {
  const menu = menuLibrary('withdrawn', 'revived', 'disliked', 'still-liked', 'eaten-only');
  const state = { counts: { 'eaten-only': 4 }, reactions: [
    { id: 'withdrawn', liked: true }, { id: 'withdrawn', liked: null },
    { id: 'withdrawn', liked: 'true' },
    { id: 'revived', liked: false, at: MENU_NOW },
    { id: 'revived', liked: true, at: MENU_NOW - MENU_DAY },
    { id: 'disliked', liked: true }, { id: 'disliked', liked: false },
    { id: 'disliked', liked: 'true' },
    { id: 'still-liked', liked: true }, { id: 'still-liked' },
    null, { id: 'missing', liked: true },
  ] };
  const liked = menuIds(filterMenuDishes(menu, state, { quick: 'liked' }, MENU_NOW));
  assert.deepEqual(liked, ['revived', 'still-liked']);
  assert.deepEqual(new Set(liked), new Set(tasteProfile(menu, state).likedIds));
  assert.ok(!liked.includes('eaten-only'), '仅有吃过计数不构成喜欢');
});

test('菜单没吃过：eaten 剪裁不抹掉持久 counts，仍在的过去记录也不误当尝鲜', () => {
  const menu = menuLibrary('trimmed', 'retained', 'history-only', 'never');
  const state = {
    counts: { trimmed: 8, retained: 1, never: 0 },
    eaten: [
      { id: 'retained', at: MENU_NOW - MENU_DAY },
      { id: 'history-only', at: MENU_NOW - MENU_DAY },
    ],
  };
  assert.ok(!state.eaten.some((e) => e.id === 'trimmed'), '模拟老记录已剪掉而计数保留');
  assert.deepEqual(menuIds(filterMenuDishes(menu, state, { quick: 'untried' }, MENU_NOW)), ['never']);
});

test('菜单最近：包含恰好七天及当前时刻，排除过期、未来、坏时间并按最近一次倒序', () => {
  const menu = menuLibrary('edge', 'near', 'now', 'old', 'future', 'past-and-future', 'bad', 'counts-only');
  const state = { counts: { 'counts-only': 9 }, eaten: [
    { id: 'near', at: MENU_NOW - 3 * MENU_DAY },
    { id: 'edge', at: MENU_NOW - 7 * MENU_DAY },
    { id: 'now', at: MENU_NOW },
    { id: 'old', at: MENU_NOW - 7 * MENU_DAY - 1 },
    { id: 'near', at: MENU_NOW - 1 },
    { id: 'future', at: MENU_NOW + 1 },
    { id: 'past-and-future', at: MENU_NOW - MENU_DAY },
    { id: 'past-and-future', at: MENU_NOW + MENU_DAY },
    { id: 'bad', at: NaN }, { id: 'bad', at: Infinity },
    { id: 'bad', at: String(MENU_NOW) }, { id: 'bad', at: null },
    null, { id: 'missing', at: MENU_NOW },
  ] };
  assert.deepEqual(menuIds(filterMenuDishes(menu, state, { quick: 'recent' }, MENU_NOW)),
    ['now', 'near', 'past-and-future', 'edge']);
});

test('菜单快捷筛选：与原菜系、类别、标签、查询逐项求交，all 保持旧筛选语义', () => {
  const menu = menuLibrary('match', 'quick-out', 'wrong-cuisine', 'wrong-category', 'wrong-keyword', 'wrong-query');
  menu.byId.get('wrong-cuisine').cuisine = '粤菜';
  menu.byId.get('wrong-category').category = '凉菜';
  menu.byId.get('wrong-keyword').keywords = ['浓郁'];
  menu.byId.get('wrong-query').ingredients = ['豆腐'];
  const filter = { cuisine: '川菜', category: '热菜', keyword: '清香', query: '花椒' };
  const ordinary = filterDishes(menu, filter);
  const all = ['match', 'quick-out'];
  assert.deepEqual(menuIds(ordinary), all);
  assert.deepEqual(filterMenuDishes(menu, {}, filter, MENU_NOW), ordinary);
  assert.deepEqual(menuIds(filterMenuDishes(menu, {}, { ...filter, quick: 'all' }, MENU_NOW)), all);
  for (const quick of ['liked', 'untried', 'recent']) {
    const state = {
      counts: { 'quick-out': 1 },
      reactions: menu.dishes.filter((d) => d.id !== 'quick-out').map((d) => ({ id: d.id, liked: true })),
      eaten: quick === 'recent'
        ? menu.dishes.filter((d) => d.id !== 'quick-out').map((d) => ({ id: d.id, at: MENU_NOW })) : [],
    };
    assert.deepEqual(menuIds(filterMenuDishes(menu, state, { ...filter, quick }, MENU_NOW)), ['match'], quick);
  }
  assert.deepEqual(filterMenuDishes(menu, {}, {}, MENU_NOW), menu.dishes);
  assert.deepEqual(filterMenuDishes(menu, {}, { quick: 'liked' }, MENU_NOW), []);
});

test('菜单推荐：明确讨厌始终排除，喜欢反转和中性撤销可重新进入候选', () => {
  const menu = menuLibrary('blocked', 'revived', 'neutral', 'eaten-only');
  const state = { counts: { 'eaten-only': 4 }, reactions: [
    { id: 'blocked', liked: true }, { id: 'blocked', liked: false }, { id: 'blocked', liked: 'true' },
    { id: 'revived', liked: false }, { id: 'revived', liked: true },
    { id: 'neutral', liked: false }, { id: 'neutral', liked: null },
  ] };
  assert.deepEqual(menuIds(recommendMenuDishes(menu, state, { nowMs: MENU_NOW, rng: () => 0 })),
    ['revived', 'neutral', 'eaten-only']);
  assert.deepEqual(menuIds(filterMenuDishes(menu, state, { quick: 'liked' }, MENU_NOW)), ['revived']);
});

test('菜单推荐：优先没吃过及最近未吃，近期反复吃降级，不足才用近期菜补齐', () => {
  const menu = menuLibrary('repeated', 'once', 'old', 'fresh');
  const state = { counts: { repeated: 9, once: 1, old: 5 }, eaten: [
    { id: 'repeated', at: MENU_NOW - MENU_DAY },
    { id: 'repeated', at: MENU_NOW - 2 * MENU_DAY },
    { id: 'once', at: MENU_NOW },
    { id: 'old', at: MENU_NOW - 8 * MENU_DAY },
    { id: 'old', at: MENU_NOW + 1 },
  ] };
  assert.deepEqual(menuIds(recommendMenuDishes(menu, state, { nowMs: MENU_NOW, rng: () => 0 })),
    ['fresh', 'old', 'once'], '即使反复吃的排在库首，也不能抢占尝鲜位置');
  assert.deepEqual(menuIds(recommendMenuDishes(menu, state, { quick: 'recent', nowMs: MENU_NOW, rng: () => 0 })),
    ['once', 'repeated'], '仅有近期菜时允许补齐，但不突破 recent 筛选');
});

test('菜单推荐：历史剪裁后仍把有持久 counts 的菜排在未尝鲜菜之后', () => {
  const menu = menuLibrary('trimmed', 'fresh');
  const state = { counts: { trimmed: 20 }, eaten: [] };
  assert.deepEqual(menuIds(recommendMenuDishes(menu, state, { limit: 1, nowMs: MENU_NOW, rng: () => 0 })), ['fresh']);
  assert.deepEqual(menuIds(recommendMenuDishes(menu, state, { quick: 'untried', nowMs: MENU_NOW, rng: () => 0 })), ['fresh']);
});

test('菜单推荐：严格限定快捷筛选与全部原条件交集，少于三道不向外凑数', () => {
  const menu = menuLibrary('keep-a', 'keep-b', 'blocked', 'wrong-cuisine', 'wrong-category', 'wrong-keyword', 'wrong-query', 'not-liked');
  menu.byId.get('wrong-cuisine').cuisine = '粤菜';
  menu.byId.get('wrong-category').category = '凉菜';
  menu.byId.get('wrong-keyword').keywords = ['浓郁'];
  menu.byId.get('wrong-query').ingredients = ['豆腐'];
  const state = { reactions: menu.dishes.filter((d) => d.id !== 'not-liked').map((d) => ({ id: d.id, liked: true })) };
  state.reactions.push({ id: 'blocked', liked: false });
  const filter = { cuisine: '川菜', category: '热菜', keyword: '清香', query: '花椒', quick: 'liked' };
  const pool = new Set(menuIds(filterMenuDishes(menu, state, filter, MENU_NOW)));
  for (const rng of [() => 0, () => 0.999]) {
    const picks = recommendMenuDishes(menu, state, { ...filter, limit: 99, nowMs: MENU_NOW, rng });
    assert.deepEqual(new Set(menuIds(picks)), new Set(['keep-a', 'keep-b']));
    assert.ok(picks.every((d) => pool.has(d.id)));
  }
});

test('菜单推荐：最多三道且按 id 不重复，同层随机支持注入及较小 limit', () => {
  const menu = menuLibrary('a', 'b', 'c', 'd');
  menu.dishes.push(menu.dishes[0]);
  const low = recommendMenuDishes(menu, {}, { limit: 99, nowMs: MENU_NOW, rng: () => 0 });
  const high = recommendMenuDishes(menu, {}, { nowMs: MENU_NOW, rng: () => 0.999 });
  assert.deepEqual(menuIds(low), ['a', 'b', 'c']);
  assert.deepEqual(menuIds(high), ['d', 'c', 'b']);
  assert.equal(new Set(menuIds(low)).size, low.length);
  assert.ok(low.every((d) => menu.byId.get(d.id) === d), '返回原始菜品对象');
  assert.deepEqual(menuIds(recommendMenuDishes(menu, {}, { limit: 1.9, nowMs: MENU_NOW, rng: () => 0 })), ['a']);
  for (const limit of [0, -1]) {
    assert.deepEqual(recommendMenuDishes(menu, {}, { limit, rng: () => assert.fail('limit 为零不应抽签') }), []);
  }
});

test('菜单推荐：单道池、全讨厌、筛选为空和空库都有准确的结果', () => {
  const menu = menuLibrary('only');
  assert.deepEqual(menuIds(recommendMenuDishes(menu, {}, { nowMs: MENU_NOW, rng: () => 0 })), ['only']);
  const rng = () => assert.fail('空池不应抽签');
  assert.deepEqual(recommendMenuDishes(menu, { reactions: [{ id: 'only', liked: false }] }, { rng }), []);
  assert.deepEqual(recommendMenuDishes(menu, {}, { cuisine: '不存在的菜系', rng }), []);
  assert.deepEqual(recommendMenuDishes(menu, {}, { quick: 'liked', rng }), []);
  assert.deepEqual(recommendMenuDishes(menuLibrary(), {}, { rng }), []);
});

test('菜单纯函数：不重排或修改库、历史、计数及反馈，不改变旧随机和筛选契约', () => {
  const menu = menuLibrary('recent', 'fresh', 'old');
  const state = {
    counts: Object.freeze({ recent: 1, old: 2 }),
    eaten: Object.freeze([{ id: 'old', at: MENU_NOW - 8 * MENU_DAY }, { id: 'recent', at: MENU_NOW }]),
    reactions: Object.freeze([{ id: 'fresh', liked: true }]),
  };
  Object.freeze(state);
  Object.freeze(menu.dishes);
  const before = JSON.stringify({ dishes: menu.dishes, state });
  filterMenuDishes(menu, state, { quick: 'recent' }, MENU_NOW);
  filterMenuDishes(menu, state, { quick: 'liked' }, MENU_NOW);
  recommendMenuDishes(menu, state, { nowMs: MENU_NOW, rng: () => 0 });
  assert.equal(JSON.stringify({ dishes: menu.dishes, state }), before);
  assert.equal(filterDishes(menu), menu.dishes, '旧筛选仍返回原始未筛数组');
  assert.equal(filterDishes(menu, { quick: 'liked' }), menu.dishes, '旧筛选不引入 quick 语义');
  assert.equal(pickFew(menu, 0, { rng: () => 0 }).length, 1, '旧 pickFew 的至少一道语义保留');
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

test('口味画像：吃过重甜重辣只记录经历，不能当作喜欢或耐受', () => {
  const profile = tasteProfile(lib, { counts: { 'mapo-tofu': 3 }, reactions: [] });
  assert.ok(profile.avg);
  assert.equal(profile.preferenceAvg, null);
  assert.equal(profile.preferenceReady, false);
  assert.equal(profile.feedbackCount, 0);
  assert.deepEqual(profile.likedIds, []);
  assert.deepEqual(profile.dislikedIds, []);
  assert.match(profile.lines.join('\n'), /饮食经历/);
  assert.match(profile.lines.join('\n'), /反馈不足/);
  assert.doesNotMatch(profile.lines.join('\n'), /能吃辣|嗜甜|辣的耐受/);
});

test('口味画像：至少两道不同的明确喜欢才归纳偏好，重复喜欢不加权', () => {
  const [a, b, c] = lib.dishes;
  const one = tasteProfile(lib, { reactions: [
    { id: a.id, liked: true }, { id: a.id, liked: true },
  ] });
  assert.equal(one.preferenceAvg, null);
  assert.equal(one.preferenceCount, 1);
  const profile = tasteProfile(lib, { counts: { [c.id]: 3 }, reactions: [
    { id: a.id, liked: true }, { id: a.id, liked: true },
    { id: b.id, liked: true }, { id: c.id, liked: false },
  ] });
  assert.equal(profile.preferenceReady, true);
  assert.equal(profile.preferenceCount, 2);
  assert.equal(profile.feedbackCount, 3);
  assert.deepEqual(profile.avg, c.taste, '经历仍然单独保留');
  for (const k of TASTE_FIELDS) {
    assert.equal(profile.preferenceAvg[k], Math.round((a.taste[k] + b.taste[k]) / 2));
  }
  assert.deepEqual(profile.dislikedIds, [c.id]);
});

test('口味画像：同菜最新意见覆盖旧意见，喜欢讨厌可双向切换', () => {
  const [a, b] = lib.dishes;
  const reactions = [{ id: a.id, liked: true }, { id: b.id, liked: true }];
  reactions.push({ id: a.id, liked: false });
  const dislike = tasteProfile(lib, { reactions });
  assert.deepEqual(dislike.likedIds, [b.id]);
  assert.deepEqual(dislike.dislikedIds, [a.id]);
  assert.equal(dislike.preferenceAvg, null, '撤回喜欢后反馈重新不足');
  assert.deepEqual(dislike.likes, [b.name]);
  assert.deepEqual(dislike.dislikes, [a.name]);

  reactions.push({ id: a.id, liked: true });
  const like = tasteProfile(lib, { reactions });
  assert.deepEqual(like.likedIds, [b.id, a.id]);
  assert.deepEqual(like.dislikedIds, []);
  assert.equal(like.preferenceReady, true);
  assert.deepEqual(like.dislikes, []);
});

test('口味画像：一般是中性，会撤销喜欢或讨厌，坏反馈不会覆盖有效意见', () => {
  const [a, b] = lib.dishes;
  const profile = tasteProfile(lib, { reactions: [
    { id: a.id, liked: true }, { id: b.id, liked: false },
    { id: a.id, liked: null }, { id: b.id, liked: null },
    null, { id: a.id, liked: 'true' }, { id: b.id },
    { id: 'missing-dish', liked: true },
  ] });
  assert.deepEqual(profile.likedIds, []);
  assert.deepEqual(profile.dislikedIds, []);
  assert.equal(profile.feedbackCount, 2);
  assert.equal(profile.preferenceAvg, null);
  assert.match(profile.lines.join('\n'), /反馈不足/);
  const valid = tasteProfile(lib, { reactions: [
    { id: a.id, liked: false }, { id: a.id, liked: 'true' },
  ] });
  assert.deepEqual(valid.dislikedIds, [a.id]);
});

test('口味画像：没有经历也可保留明确反馈；空画像仍返回完整偏好字段', () => {
  const [a, b] = lib.dishes;
  const profile = tasteProfile(lib, { reactions: [{ id: a.id, liked: true }, { id: b.id, liked: true }] });
  assert.equal(profile.empty, true, 'empty 兼容表示没有饮食经历');
  assert.equal(profile.avg, null);
  assert.ok(profile.preferenceAvg);
  assert.match(profile.lines.join('\n'), /明确喜欢/);
  const empty = tasteProfile(lib);
  assert.equal(empty.preferenceAvg, null);
  assert.deepEqual(empty.likes, []);
  assert.deepEqual(empty.dislikes, []);
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
