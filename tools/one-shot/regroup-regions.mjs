/**
 * regroup-regions.mjs —— 把「家常菜」「甜品」两个**非地域组**拆掉，同时修掉全库
 * 「region 写的是甲地、cuisine 却是乙菜系」的错位。一次性迁移脚本。
 *
 * 用法：node tools/regroup-regions.mjs [--dry]
 *
 * 为什么要拆：
 *   · `家常菜` 是**风格**不是地域，和「cuisine 只说地域」的规矩冲突。它的 15 道里
 *     大半 region 本来就写着具体地方（红烧排骨=江苏苏州、手撕包菜=湖南长沙…）。
 *   · `甜品` 在 `category` 里已经有了，菜系里再放一个就是同一根轴出现两次。
 *     它的 12 道都能按 region 归位（双皮奶=顺德、铜锣烧=东京…）。
 *   · 每次「为一道菜保留一个例外」都会在下一次加菜时重新变成问题，所以这次不留例外。
 *
 * 顺带改的组名：
 *   · 江浙菜 → 江浙沪菜（组里上海菜占了三道：葱油拌面、生煎包、腌笃鲜）
 *   · 云贵菜 → 西南菜（组里有广西南宁的老友粉）
 *   · 南欧菜 → 欧洲菜（要收黑森林蛋糕；也让比利时薯条、布鲁塞尔热可可有地方去）
 *
 * 迁移只动 cuisine / region 两个字段，prose 一个字不碰。
 *
 * 退出码：0 = 成功；1 = 有菜没有归宿（不写盘）。
 */
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');
const dry = process.argv.includes('--dry');

/** 文件名 → 菜系。这次定稿的 21 组。 */
const TARGET = {
  sichuan: '川菜',
  cantonese: '粤菜',
  'jiangzhe-hu': '江浙沪菜',
  northern: '北方菜',
  hunan: '湘菜',
  southwest: '西南菜',
  northeast: '东北菜',
  northwest: '西北菜',
  'fujian-taiwan': '闽台菜',
  shandong: '鲁菜',
  hubei: '鄂菜',
  japanese: '日料',
  korean: '韩式',
  'southeast-asian': '东南亚',
  indian: '印度菜',
  mexican: '墨西哥菜',
  italian: '意菜',
  french: '法餐',
  european: '欧洲菜',
  'anglo-american': '英美菜',
  'middle-eastern': '中东菜',
};

/** 旧文件名 → 新文件名（整组改名，组里的菜不动）。 */
const RENAME_SLUG = {
  jiangnan: 'jiangzhe-hu',
  'yunnan-guizhou': 'southwest',
  'southern-european': 'european',
};

/** 逐道的归宿：id → 新 slug。拆组和错位都写在这。 */
const MOVES = {
  // —— 家常菜拆掉（15）：按 region 各自归位 ——
  'braised-pork-ribs': 'jiangzhe-hu',        // 江苏苏州
  'steamed-egg-custard': 'jiangzhe-hu',      // 江南
  'cola-chicken-wings': 'northern',          // 北京
  'shredded-potato': 'northern',             // 山西太原
  'tomato-scrambled-eggs': 'northern',       // 北方人家
  'smashed-cucumber-salad': 'northern',      // 拍黄瓜是北方凉菜
  'hand-torn-cabbage': 'hunan',              // 湖南长沙
  'seaweed-egg-drop-soup': 'shandong',       // 山东青岛
  'steamed-sea-bass': 'cantonese',           // 广东广州
  'tomato-beef-brisket-soup': 'cantonese',   // 香港九龙城
  'garlic-vermicelli-cabbage': 'cantonese',  // 粤式蒸法
  'green-pepper-pork': 'sichuan',            // 川味小炒
  'winter-melon-meatball-soup': 'jiangzhe-hu',
  'watermelon-slush': 'northwest',           // 新疆吐鲁番
  'watermelon-juice': 'northwest',           // 同上，夏天那口瓜

  // —— 甜品拆掉（12）：按 region 各自归位 ——
  'shuang-pinai': 'cantonese',               // 广东顺德
  'ginger-milk-curd': 'cantonese',           // 广东番禺
  'tang-but-lao': 'cantonese',               // 广东东莞
  'black-sesame-paste': 'cantonese',         // 广东
  'snow-skin-mochi': 'cantonese',            // 香港
  'osmanthus-jiuniang-yuanzi': 'jiangzhe-hu', // 江南
  'osmanthus-cake': 'jiangzhe-hu',           // 江南
  'almond-tofu': 'northern',                 // 北京
  'taro-paste': 'fujian-taiwan',             // 福建
  'durian-mille-crepe': 'southeast-asian',   // 马来西亚槟城
  'dorayaki': 'japanese',                    // 日本东京
  'black-forest-cake': 'european',           // 德国黑森林

  // —— 其余错位（region 与 cuisine 对不上）——
  'scallion-pancake': 'jiangzhe-hu',         // 上海黄浦，原来在北方菜
  'chive-pockets': 'shandong',               // 山东济南，原来在北方菜
  'lamb-offal-soup': 'northwest',            // 陕西西安，原来在北方菜
  'tang-suan': 'northern',                   // 北京，原来在鲁菜
  'mung-bean-popsicle': 'northern',          // 北京，原来在东北菜
  'pork-enoki-skewer': 'northeast',          // 东北夜市，原来在韩式
  'red-bean-milk-ice': 'fujian-taiwan',      // 台湾台南，原来在粤菜
  'tremella-lotus-soup': 'fujian-taiwan',    // 福建古田，原来在江浙
  'vanilla-ice-cream': 'french',             // 法国巴黎，原来在意菜
  'crispy-fries': 'european',                // 比利时布鲁塞尔，原来在法餐
  'caesar-salad': 'mexican',                 // 墨西哥蒂华纳，原来在英美菜
  // 这道是淮扬写法（勾芡的羹、笋丝、白胡椒的辣"不在舌头上"），不是川式红油那路，
  // region 也写江苏扬州——所以按地域归江浙沪。
  'hot-sour-soup': 'jiangzhe-hu',
  'roast-chicken': 'italian',                // 意大利托斯卡纳，原来在英美菜
  'hand-drip-yirgacheffe': 'middle-eastern', // 埃塞俄比亚，咖啡经也门传入阿拉伯
  'cold-brew': 'japanese',                   // 日本京都，原来在英美菜
  'hot-chocolate': 'european',               // 布鲁塞尔，原来在英美菜
};

/**
 * region 只写「中国」「夏夜路边」这类、等于没写的五道，补成一个具体地方，
 * 否则它们在「cuisine 只说地域」的库里没有立足点。
 */
const REGION_FIX = {
  'green-pepper-pork': '四川成都',
  'smashed-cucumber-salad': '北京',
  'garlic-vermicelli-cabbage': '广东广州',
  'winter-melon-meatball-soup': '上海',
  'watermelon-juice': '新疆吐鲁番',
  // 重庆 1997 年就是直辖市了，写「四川重庆」是旧的行政区划说法。
  'shuizhu-yu': '重庆江北',
};

const read = async (f) => JSON.parse(await readFile(join(dataDir, f), 'utf8'));
const write = async (f, arr) => writeFile(join(dataDir, f), `${JSON.stringify(arr, null, 2)}\n`, 'utf8');

const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
const slugOfFile = (f) => f.replace(/\.json$/, '');

/** 收集全库，逐道定归宿。 */
const bucket = new Map();   // 新 slug → 菜
const unmapped = [];
let moved = 0;

for (const file of files) {
  const slug = slugOfFile(file);
  const next = RENAME_SLUG[slug] ?? slug;
  for (const dish of await read(file)) {
    const target = MOVES[dish.id] ?? next;
    if (!TARGET[target]) {
      unmapped.push(`${dish.id}（${dish.name}）→ 未知的组 ${target}`);
      continue;
    }
    if (MOVES[dish.id] && MOVES[dish.id] !== next) moved += 1;
    const out = {
      ...dish,
      cuisine: TARGET[target],
      region: REGION_FIX[dish.id] ?? dish.region,
    };
    if (!bucket.has(target)) bucket.set(target, []);
    bucket.get(target).push(out);
  }
}

if (unmapped.length) {
  console.error(`✗ ${unmapped.length} 道没有归宿，一个都没写盘：`);
  for (const u of unmapped) console.error(`  · ${u}`);
  process.exit(1);
}

// 每组按原名排一下，diff 才读得懂（同一组内保持原顺序，跨组才有变化）。
const counts = [...bucket.entries()]
  .map(([slug, arr]) => [slug, arr])
  .sort((a, b) => a[0].localeCompare(b[0]));

const total = counts.reduce((n, [, arr]) => n + arr.length, 0);
console.log(`目标：${counts.length} 组 / ${total} 道，其中 ${moved} 道换了组。`);

const thin = counts.filter(([, arr]) => arr.length < 12);
if (thin.length) {
  console.log('\n⚠️ 不足 12 道的组（要补菜）：');
  for (const [slug, arr] of thin) console.log(`  ${slug}：${arr.length} 道`);
}

console.log('');
for (const [slug, arr] of counts) console.log(`  ${TARGET[slug].padEnd(5)} ${String(arr.length).padStart(3)}  ${slug}.json`);

const obsolete = files
  .map(slugOfFile)
  .filter((s) => !bucket.has(RENAME_SLUG[s] ?? s));

if (dry) {
  console.log(`\n[--dry] 会删掉：${obsolete.join(', ') || '（无）'}`);
  process.exit(0);
}

/**
 * 该删的是「文件名本身不是这次定稿的组」的那些。注意别用 RENAME_SLUG 换算之后
 * 再判断——改名组换算后正好落在 keep 里，旧文件就会被当成「保留」而留在盘上，
 * 于是同一个菜系出现两份（jiangnan.json 和 jiangzhe-hu.json）。
 */
const keep = new Set(counts.map(([slug]) => slug));
for (const file of files) {
  const slug = slugOfFile(file);
  if (!keep.has(slug)) await unlink(join(dataDir, file));
}

for (const [slug, arr] of counts) await write(`${slug}.json`, arr);

console.log(`\n✓ 写了 ${counts.length} 个文件，删了 ${obsolete.length} 个旧文件。`);
