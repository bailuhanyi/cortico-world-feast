/**
 * regroup.mjs —— 0.2.0 → 0.3.0 的一次性数据迁移：把「菜系轴」和「形态轴」拆开。
 *
 * 起因：0.2.0 的 25 个组混着两根轴。川菜/粤菜/湘菜是**从哪来**（地域），
 * 面点主食/汤羹/中式小吃/烧烤与夜市/饮品/冰品与冷饮是**是什么**（形态）。
 * 结果就是同一道菜有两处归属、必然撞车（生煎包在「中式小吃」、小笼包在「面点主食」；
 * 新疆羊肉串在「烧烤」、新疆大盘鸡在「西北菜」）。
 *
 * 0.3.0 起：cuisine 只说地域/传统，形态全交给 category。形态组全部解散，
 * 里面的菜按 id 归回各自菜系；清真菜拆进西北与北方；寿司与热食合成日料；
 * 韩泰拆成韩式与东南亚；西餐按国别拆成意/法/南欧/英美。甜品按青的决定保留独立一组。
 *
 * 用法：node tools/regroup.mjs [--dry]
 *
 * 这个脚本只在旧布局上调一次；跑第二遍是空操作（每道菜都已在新组里）。
 */
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS as GROUPS_V3 } from './validate-dishes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');
const dry = process.argv.includes('--dry');

/**
 * 每道旧菜的新归属。原文件 → 新文件，逐道写明，因为并组后编号不代表归属。
 * 右边是新组 slug；不在表里的 id 会让脚本报错退出（宁可红，不要悄悄丢菜）。
 */
export const MOVE = {
  // ── 川菜 ──
  'mapo-tofu': 'sichuan',
  'shuizhu-yu': 'sichuan',
  'suanmi-bairou': 'sichuan',
  'tiantian-shuimian': 'sichuan',
  'hot-twice-cooked-pork': 'sichuan',
  'dan-dan-noodles': 'sichuan',
  'kou-shui-ji': 'sichuan',
  'suancai-yu': 'sichuan',
  'hot-sour-sweet-potato-noodles': 'sichuan',
  'hot-sour-soup': 'sichuan',
  'grilled-brains': 'sichuan',

  // ── 粤菜 ──
  'steamed-star-grouper': 'cantonese',
  'white-cut-chicken': 'cantonese',
  'beef-chow-fun': 'cantonese',
  'chenpi-red-bean-soup': 'cantonese',
  'roast-goose': 'cantonese',
  'har-gow': 'cantonese',
  'chicken-feet-black-bean': 'cantonese',
  'cantonese-slow-soup': 'cantonese',
  'cantonese-rice-noodle-roll': 'cantonese',
  'winter-melon-pork-soup': 'cantonese',
  'hong-kong-milk-tea': 'cantonese',
  'mango-pomelo-sago': 'cantonese',
  'red-bean-milk-ice': 'cantonese',
  'grilled-oysters-garlic': 'cantonese',
  'mango-pancake': 'cantonese',

  // ── 江浙菜 ──
  'dongpo-pork': 'jiangnan',
  'west-lake-vinegar-fish': 'jiangnan',
  'longjing-shrimp': 'jiangnan',
  'shaoxing-drunk-crab': 'jiangnan',
  'squirrel-mandarin-fish': 'jiangnan',
  'crab-xiaolong': 'jiangnan',
  'yan-du-xian': 'jiangnan',
  'scallion-oil-noodles': 'jiangnan',
  'xiaolongbao': 'jiangnan',
  'shengjian-bao': 'jiangnan',
  'song-sao-fish-soup': 'jiangnan',
  'tremella-lotus-soup': 'jiangnan',

  // ── 北方菜（含清真里的北京几道） ──
  'jing-jiang-rou-si': 'northern',
  'lao-beijing-zhajiang-mian': 'northern',
  'chao-gan': 'northern',
  'peking-duck': 'northern',
  'pot-stickers': 'northern',
  'instant-boiled-mutton': 'northern',
  'chive-pockets': 'northern',
  'scallion-pancake': 'northern',
  'hulatang': 'northern',
  'lvdagun': 'northern',
  'bing-tang-hulu': 'northern',
  'jianbing-guozi': 'northern',
  'sour-plum-soup': 'northern',
  'ta-si-mi': 'northern',
  'lamb-offal-soup': 'northern',
  'baodu': 'northern',

  // ── 鲁菜 ──
  'tang-suan': 'shandong',
  'scallion-braised-sea-cucumber': 'shandong',

  // ── 湘菜 ──
  'duojiao-yutou': 'hunan',
  'lei-lajiao-pidan': 'hunan',
  'kouwei-xia': 'hunan',
  'lawei-hezheng': 'hunan',
  'stir-fried-beef-hunan': 'hunan',
  'mao-braised-pork': 'hunan',
  'changsha-rice-noodles': 'hunan',
  'smoked-tofu-bacon': 'hunan',
  'changsha-stinky-tofu': 'hunan',
  'tang-you-ba-ba': 'hunan',

  // ── 云贵菜 ──
  'guoqiao-mixian': 'yunnan-guizhou',
  'qiguo-ji': 'yunnan-guizhou',
  'suantang-yu': 'yunnan-guizhou',
  'siwawa': 'yunnan-guizhou',
  'laoyou-rice-noodles': 'yunnan-guizhou',
  'yunnan-ham-erkuai': 'yunnan-guizhou',
  'houttuynia-tofu': 'yunnan-guizhou',
  'wild-mushroom-hotpot': 'yunnan-guizhou',

  // ── 东北菜 ──
  'guo-bao-rou': 'northeast',
  'xiao-ji-dun-mogu': 'northeast',
  'dong-bei-da-la-pi': 'northeast',
  'ba-si-di-gua': 'northeast',
  'su-quan-pork-stew': 'northeast',
  'di-san-xian': 'northeast',
  'liu-rou-duan': 'northeast',
  'sticky-bean-bun': 'northeast',
  'kao-leng-mian': 'northeast',
  'garlic-roasted-eggplant': 'northeast',
  'mung-bean-popsicle': 'northeast',

  // ── 西北菜（含清真里的西北几道） ──
  'lamb-paomo': 'northwest',
  'hand-grabbed-lamb': 'northwest',
  'qishan-saozi-noodles': 'northwest',
  'xinjiang-big-plate-chicken': 'northwest',
  'naan': 'northwest',
  'shaanxi-liangpi': 'northwest',
  'huang-men-lamb': 'northwest',
  'qinghai-yogurt': 'northwest',
  'lanzhou-beef-noodles': 'northwest',
  'biangbiang-noodles': 'northwest',
  'roujiamo': 'northwest',
  'xinjiang-lamb-skewers': 'northwest',
  'pilaf': 'northwest',
  'stir-fried-lamb': 'northwest',
  'naan-wrapped-lamb': 'northwest',
  'youxiang-fentang': 'northwest',
  'eight-treasure-tea': 'northwest',

  // ── 家常菜 ──
  'tomato-scrambled-eggs': 'home-cooking',
  'braised-pork-ribs': 'home-cooking',
  'steamed-sea-bass': 'home-cooking',
  'hand-torn-cabbage': 'home-cooking',
  'steamed-egg-custard': 'home-cooking',
  'shredded-potato': 'home-cooking',
  'cola-chicken-wings': 'home-cooking',
  'seaweed-egg-drop-soup': 'home-cooking',
  'tomato-beef-brisket-soup': 'home-cooking',
  'watermelon-juice': 'home-cooking',
  'watermelon-slush': 'home-cooking',

  // ── 闽台菜 ──
  'fotiaoqiang': 'fujian-taiwan',
  'oyster-omelette': 'fujian-taiwan',
  'taiwanese-popcorn-chicken': 'fujian-taiwan',
  'iced-pearl-milk-tea': 'fujian-taiwan',
  'mango-shaved-ice': 'fujian-taiwan',

  // ── 鄂菜 ──
  'wuhan-hot-dry-noodles': 'hubei',

  // ── 日料 ──
  'tuna-otoro-nigiri': 'japanese',
  'uni-gunkan-maki': 'japanese',
  'unagi-nigiri': 'japanese',
  'tamagoyaki-nigiri': 'japanese',
  'engawa-nigiri': 'japanese',
  'tekka-maki': 'japanese',
  'chirashi-zushi': 'japanese',
  'inari-zushi': 'japanese',
  'tonkotsu-ramen': 'japanese',
  'ebi-tempura': 'japanese',
  'kansai-sukiyaki': 'japanese',
  'chawanmushi': 'japanese',
  'oyakodon': 'japanese',
  'tonkatsu': 'japanese',
  'oden': 'japanese',
  'miso-black-cod': 'japanese',
  'miso-soup': 'japanese',
  'japanese-cheesecake': 'japanese',
  'matcha-latte': 'japanese',
  'grilled-sanma': 'japanese',

  // ── 韩式 ──
  'budae-jjigae': 'korean',
  'korean-fried-chicken': 'korean',
  'bibimbap': 'korean',
  'samgyeopsal': 'korean',
  'pork-enoki-skewer': 'korean',

  // ── 东南亚 ──
  'som-tam': 'southeast-asian',
  'mango-sticky-rice': 'southeast-asian',
  'tom-yum-goong': 'southeast-asian',
  'pad-kra-pao-moo': 'southeast-asian',
  'hanoi-beef-pho': 'southeast-asian',
  'banh-mi-thit-nuong': 'southeast-asian',
  'goi-cuon-tom': 'southeast-asian',
  'laksa-katong': 'southeast-asian',
  'banh-xeo': 'southeast-asian',
  'thit-kho-tau': 'southeast-asian',
  'nasi-goreng': 'southeast-asian',
  'hainanese-chicken-rice': 'southeast-asian',

  // ── 印度菜 ──
  'butter-chicken': 'indian',
  'masala-dosa': 'indian',
  'biryani': 'indian',
  'paratha': 'indian',
  'chana-masala': 'indian',
  'tandoori-chicken': 'indian',
  'palak-paneer': 'indian',
  'mango-lassi': 'indian',

  // ── 墨西哥菜 ──
  'tacos-al-pastor': 'mexican',
  'mole-poblano': 'mexican',
  'tamales': 'mexican',
  'pozole': 'mexican',
  'chilaquiles': 'mexican',
  'ceviche': 'mexican',
  'guacamole': 'mexican',
  'elote': 'mexican',

  // ── 意菜 ──
  'margherita-pizza': 'italian',
  'burrata-caprese': 'italian',
  'saffron-risotto': 'italian',
  'tiramisu': 'italian',
  'ragu-alla-bolognese': 'italian',
  'carbonara': 'italian',
  'cotoletta-alla-milanese': 'italian',
  'cacciucco': 'italian',
  'vanilla-ice-cream': 'italian',
  'pistachio-gelato': 'italian',

  // ── 法餐 ──
  'french-onion-soup': 'french',
  'french-souffle': 'french',
  'macaron': 'french',
  'creme-brulee': 'french',
  'crispy-fries': 'french',

  // ── 南欧菜（西葡 + 地中海甜点） ──
  'paella': 'southern-european',
  'basque-burnt-cheesecake': 'southern-european',
  'pastel-de-nata': 'southern-european',

  // ── 英美菜 ──
  'ribeye-steak': 'anglo-american',
  'caesar-salad': 'anglo-american',
  'fish-and-chips': 'anglo-american',
  'eggs-benedict': 'anglo-american',
  'roast-chicken': 'anglo-american',
  'whisky-highball': 'anglo-american',
  'hot-chocolate': 'anglo-american',
  'hand-drip-yirgacheffe': 'anglo-american',
  'cold-brew': 'anglo-american',

  // ── 甜品（按青的决定保留独立一组） ──
  'black-forest-cake': 'desserts',
};

/**
 * category 修正：形态组解散后，凡「只有形态组才说得通」的类别都要落到位。
 * 主要是冰品——冰淇淋/雪糕/刨冰归甜品，冰沙是可喝的归饮品。
 */
const CATEGORY_FIX = {
  'mango-shaved-ice': '甜品',
  'vanilla-ice-cream': '甜品',
  'mung-bean-popsicle': '甜品',
  'watermelon-slush': '饮品',
  'red-bean-milk-ice': '甜品',
  'pistachio-gelato': '甜品',
};

const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json')).sort();
const buckets = new Map(Object.keys(GROUPS_V3).map((s) => [s, []]));
const unmapped = [];
const seen = new Set();

for (const file of files) {
  const slug = file.replace(/\.json$/, '');
  const arr = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
  if (!Array.isArray(arr)) {
    console.error(`✗ ${file} 顶层不是数组`);
    process.exit(1);
  }
  for (const dish of arr) {
    if (!dish?.id) {
      console.error(`✗ ${file} 里有条目没有 id`);
      process.exit(1);
    }
    if (seen.has(dish.id)) {
      console.error(`✗ id 重复：${dish.id}（文件 ${file}）`);
      process.exit(1);
    }
    seen.add(dish.id);
    const target = MOVE[dish.id];
    if (!target) { unmapped.push(`${dish.id}（现在在 ${slug}.json）`); continue; }
    if (!GROUPS_V3[target]) {
      console.error(`✗ ${dish.id} 指向不存在的组 ${target}`);
      process.exit(1);
    }
    if (CATEGORY_FIX[dish.id]) dish.category = CATEGORY_FIX[dish.id];
    dish.cuisine = GROUPS_V3[target];
    buckets.get(target).push(dish);
  }
}

if (unmapped.length) {
  console.error(`✗ ${unmapped.length} 道菜没写新归属，先补 MOVE：`);
  for (const u of unmapped) console.error(`  · ${u}`);
  process.exit(1);
}

console.log(`读完 ${files.length} 个文件、${seen.size} 道菜。`);
for (const [slug, arr] of [...buckets].sort()) {
  const cats = [...new Set(arr.map((d) => d.category))].join('/');
  console.log(`  ${slug.padEnd(18)} ${String(arr.length).padStart(3)} 道  ${GROUPS_V3[slug]}  ${cats || '（还空着）'}`);
}
const total = [...buckets.values()].reduce((n, a) => n + a.length, 0);
console.log(`合计 ${total} 道 / ${buckets.size} 组。`);

if (dry) { console.log('\n（--dry：没写盘）'); process.exit(0); }

const keep = [];
for (const [slug, arr] of buckets) {
  if (!arr.length) continue;
  arr.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(join(dataDir, `${slug}.json`), `${JSON.stringify(arr, null, 2)}\n`, 'utf8');
  keep.push(`${slug}.json`);
}
for (const file of files) {
  if (!keep.includes(file)) { await unlink(join(dataDir, file)); console.log(`删掉旧文件 ${file}`); }
}
console.log(`\n✅ 写成 ${keep.length} 个文件：${keep.join('、')}`);