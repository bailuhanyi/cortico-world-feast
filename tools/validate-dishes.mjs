/**
 * validate-dishes.mjs —— 校验 src/data/*.json 里的菜品档案是否符合契约。
 *
 * 用法：node tools/validate-dishes.mjs [--fix-report]
 *
 * 查什么：
 *   · 每个文件必须是数组，元素是对象
 *   · 字段一个不多一个不少（契约见 src/dishes.js 的 DISH_FIELDS）
 *   · taste 的九个维度必须是 0-100 的整数
 *   · category 必须落在白名单里
 *   · id 全库唯一、是 kebab-case
 *   · prose 至少 40 字，且不含套话黑名单
 *   · cuisine 要和文件名对得上（文件名 → 菜系组的映射见 GROUPS）
 *
 * 退出码：0 = 全过；1 = 有问题（问题逐条打印）。
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');

export const DISH_FIELDS = [
  'id', 'name', 'alias', 'cuisine', 'category', 'region', 'ingredients',
  'method', 'serving', 'taste', 'texture', 'aroma', 'finish', 'prose', 'keywords',
];

export const TASTE_FIELDS = ['辣', '麻', '咸', '鲜', '甜', '酸', '苦', '油', '香'];

export const CATEGORIES = [
  '热菜', '凉菜', '主食', '汤羹', '面点', '小吃', '甜品', '饮品', '烧烤', '火锅',
];

/**
 * 文件名 → 该文件里 cuisine 应有的值。
 *
 * 0.3.0 起，cuisine 只说**地域/传统**（这道菜从哪来），形态（热菜/汤羹/面点/小吃/
 * 甜品/饮品/烧烤/火锅）一律交给 category。所以这里不再有「汤羹」「中式小吃」「饮品」
 * 这类形态组——它们和菜系是两根轴，混在一起必然撞车（生煎包 vs 小笼包、
 * 新疆羊肉串 vs 新疆大盘鸡）。
 *
 * **只有一个例外，而且理由跟「甜品」「家常菜」都不一样**：`staples`（特别餐食）里装的是
 * **白米饭 + 四家连锁（肯德基/麦当劳/汉堡王/海底捞）各 6 道，共 25 道**。前两个例外被拆，
 * 是因为它们是**风格/形态**，和 category 那根轴重复，而且会越收越多变成垃圾场。这一组不是形态：
 * 白米饭没有产地可写，写哪个省都是编的；连锁快餐的菜是品牌的，硬按地域归组等于替它认了个祖籍。
 * 所以这一组的名字用**身份**（「特别餐食」），不复用 category 里的「主食」：那个词是形态，
 * 拿来做菜系名就是同一根轴出现两次，卡片上会印出「主食·主食」。「特别餐食」不是任何
 * category 的值，不撞那根轴，也不会被 `category: "主食"` 那种问法误伤。
 *
 * 25 道上限是**用户明确要求的例外**（2026-11，加四家连锁各 6 道），不是偷偷开的筐：
 * `GROUP_CAPS` 把它钉死在 25，守门测试逐条数（白米饭 1 + 四家各 6），多一道就红。
 * 除此之外，库里不许再有非地域组。
 *
 * 0.3.0 曾留过一个 `desserts`（甜品），理由是"黑森林蛋糕这类德式甜点没有别的家"，
 * 但 0.4.0 拆了：它和 category 里的「甜品」是同一个词，等于同一根轴出现两次；而且每次为了
 * 某一道菜留一个例外，下一次加菜时就会重新变成问题。现在甜品按地区各归各家
 * （双皮奶→粤菜、铜锣烧→日料、黑森林蛋糕→中欧菜）。同理，「家常菜」作为**风格**
 * 也拆掉了：它的菜按 region 各自归位。
 *
 * 0.5.0 补到 500 道时又开了三个外餐组（拉美菜、东欧菜、非洲菜），并把「印度菜」改名
 * 成「南亚菜」——那一组要收巴基斯坦、斯里兰卡、孟加拉的菜，再叫印度菜就不老实了。
 * 开组的理由只有一个：**那片地方真有很多菜，而且和邻近组的地域不重叠**，
 * 不是为了把某几道菜塞进去。
 *
 * 0.6.0 补到 700 道（+ 主食那一碗）时开了徽菜、赣菜，并把「欧洲菜」拆成「南欧菜」「中欧菜」：
 * 徽菜是八大菜系里唯一完全缺席的一片地方，赣菜同理一口没占；「欧洲菜」是 0.4.0 从
 * 「南欧菜」改名来的临时筐，18 道混着六个国家，再涨就是一锅——**按地理拆，不按形态拆**。
 */
export const GROUPS = {
  // 中餐 13
  'sichuan': '川菜',
  'cantonese': '粤菜',
  'jiangzhe-hu': '江浙沪菜',
  'northern': '北方菜',
  'hunan': '湘菜',
  'southwest': '西南菜',
  'northeast': '东北菜',
  'northwest': '西北菜',
  'fujian-taiwan': '闽台菜',
  'shandong': '鲁菜',
  'hubei': '鄂菜',
  'anhui': '徽菜',
  'jiangxi': '赣菜',
  // 外餐 14
  'japanese': '日料',
  'korean': '韩式',
  'southeast-asian': '东南亚',
  'south-asian': '南亚菜',
  'mexican': '墨西哥菜',
  'italian': '意菜',
  'french': '法餐',
  'southern-european': '南欧菜',
  'central-european': '中欧菜',
  'anglo-american': '英美菜',
  'middle-eastern': '中东菜',
  'latin-american': '拉美菜',
  'eastern-european': '东欧菜',
  'african': '非洲菜',
  // 唯一的非地域例外：白米饭 + 四家连锁各 6 道 = 25 道（见上面注释），上限见 GROUP_CAPS。
  // 0.6.2 起不叫「主食」：那是 category 上的形态名，同名会让卡片印出「主食·主食」，
  // 两个下拉也都有一项叫「主食」。0.6.2 当时叫「白饭」，2026-11 改成「特别餐食」——
  // 这一组装的不再只是一碗饭，名字说的是身份，仍然不是形态。见 main() 末尾那条撞名检查。
  'staples': '特别餐食',
};

/**
 * 例外组的道数上限。写死在这里，validate-dishes 和测试都按它判，
 * 免得「特别餐食」这个筐被后人越塞越多——那正是 0.4.0 拆掉「家常菜」「甜品」的原因。
 * 25 = 白米饭 1 + 肯德基/麦当劳/汉堡王/海底捞各 6 道（2026-11 用户明确要求的那一批）。
 * 想加第 26 道，先回来改这里，再同步 test/dishes.test.mjs 的守门断言和 DISH-SPEC 第 2.1 节。
 */
export const GROUP_CAPS = { staples: 25 };

/** prose 里出现这些词就是套话，打回。 */
export const BANNED = [
  '令人', '回味无穷', '唇齿留香', '欲罢不能', '妙不可言', '垂涎',
  '赞不绝口', '让人', '深深地', '无比',
];

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checkTaste(taste, where, problems) {
  if (!taste || typeof taste !== 'object' || Array.isArray(taste)) {
    problems.push(`${where}: taste 不是对象`);
    return;
  }
  const keys = Object.keys(taste);
  const extra = keys.filter((k) => !TASTE_FIELDS.includes(k));
  const missing = TASTE_FIELDS.filter((k) => !keys.includes(k));
  if (extra.length) problems.push(`${where}: taste 多出维度 ${extra.join('/')}`);
  if (missing.length) problems.push(`${where}: taste 缺维度 ${missing.join('/')}`);
  for (const k of TASTE_FIELDS) {
    const v = taste[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      problems.push(`${where}: taste.${k} 不是数字（${JSON.stringify(v)}）`);
    } else if (v < 0 || v > 100) {
      problems.push(`${where}: taste.${k} = ${v}，超出 0-100`);
    } else if (!Number.isInteger(v)) {
      problems.push(`${where}: taste.${k} = ${v}，不是整数`);
    }
  }
}

export function checkDish(dish, where, problems) {
  if (!dish || typeof dish !== 'object' || Array.isArray(dish)) {
    problems.push(`${where}: 不是一个对象`);
    return null;
  }
  const keys = Object.keys(dish);
  const extra = keys.filter((k) => !DISH_FIELDS.includes(k));
  const missing = DISH_FIELDS.filter((k) => !keys.includes(k));
  if (extra.length) problems.push(`${where}: 多出字段 ${extra.join('/')}`);
  if (missing.length) problems.push(`${where}: 缺字段 ${missing.join('/')}`);

  if (typeof dish.id !== 'string' || !ID_RE.test(dish.id)) {
    problems.push(`${where}: id 不是 kebab-case（${JSON.stringify(dish.id)}）`);
  }
  for (const f of ['name', 'cuisine', 'category', 'region', 'method', 'serving', 'texture', 'aroma', 'finish', 'prose']) {
    if (typeof dish[f] !== 'string' || !dish[f].trim()) {
      problems.push(`${where}: ${f} 是空串或不是字符串`);
    }
  }
  if (typeof dish.alias !== 'string') problems.push(`${where}: alias 不是字符串`);
  if (Array.isArray(dish.ingredients)) {
    if (dish.ingredients.length < 3 || dish.ingredients.length > 6) {
      problems.push(`${where}: ingredients 有 ${dish.ingredients.length} 样，应为 3-6`);
    }
    if (dish.ingredients.some((x) => typeof x !== 'string' || !x.trim())) {
      problems.push(`${where}: ingredients 里有空白项`);
    }
  } else {
    problems.push(`${where}: ingredients 不是数组`);
  }
  if (Array.isArray(dish.keywords)) {
    if (dish.keywords.length < 2 || dish.keywords.length > 4) {
      problems.push(`${where}: keywords 有 ${dish.keywords.length} 个，应为 2-4`);
    }
  } else {
    problems.push(`${where}: keywords 不是数组`);
  }
  if (typeof dish.category === 'string' && !CATEGORIES.includes(dish.category)) {
    problems.push(`${where}: category「${dish.category}」不在白名单里`);
  }
  checkTaste(dish.taste, where, problems);

  if (typeof dish.prose === 'string') {
    const n = dish.prose.replace(/\s/g, '').length;
    if (n < 40) problems.push(`${where}: prose 只有 ${n} 字，太短`);
    if (n > 400) problems.push(`${where}: prose 有 ${n} 字，太长`);
    for (const bad of BANNED) {
      if (dish.prose.includes(bad)) problems.push(`${where}: prose 里有套话「${bad}」`);
    }
  }
  return dish.id;
}

async function main() {
  const problems = [];
  const seen = new Map();
  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
  let total = 0;
  const byCuisine = new Map();

  for (const file of files) {
    const slug = file.replace(/\.json$/, '');
    let arr;
    try {
      arr = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: JSON 解析失败 —— ${err.message}`);
      continue;
    }
    if (!Array.isArray(arr)) {
      problems.push(`${file}: 顶层不是数组`);
      continue;
    }
    const want = GROUPS[slug];
    if (!want) problems.push(`${file}: 文件名不在 GROUPS 映射里`);
    arr.forEach((dish, i) => {
      const where = `${file}[${i}]`;
      const id = checkDish(dish, where, problems);
      if (id) {
        if (seen.has(id)) problems.push(`${where}: id 重复（已在 ${seen.get(id)} 出现过）`);
        else seen.set(id, where);
        count(byCuisine, dish.cuisine);
      }
      if (want && dish?.cuisine !== want) {
        problems.push(`${where}: cuisine 是「${dish?.cuisine}」，应为「${want}」`);
      }
    });
    total += arr.length;
  }

  for (const slug of Object.keys(GROUPS)) {
    if (!files.includes(`${slug}.json`)) problems.push(`${slug}.json: 文件不存在`);
  }

  // 菜系和形态是两根轴，所以菜系组的名字不许和 category 的形态名撞车。
  // 0.6.0 的 staples 曾叫「主食」：卡片上印出「主食·主食」，菜系下拉和类别下拉
  // 各有一项同名，点哪边都能筛到同一碗饭——这就是 0.4.0 拆掉「甜品」组的理由
  // （同一根轴出现两次），只是小号版。0.6.2 先改名「白饭」，2026-11 再改成「特别餐食」
  // （那一组装进了四家连锁，「白饭」已经名不副实）。「特别餐食」不在 CATEGORIES 里，天然通过。
  for (const [slug, name] of Object.entries(GROUPS)) {
    if (CATEGORIES.includes(name)) {
      problems.push(`GROUPS.${slug}: 菜系名「${name}」和 category 的形态名撞车——菜系只说地域/身份，形态只走 category`);
    }
  }

  // 例外组只许那么多道（`staples` = 白米饭 1 + 四家连锁 24 = 25，多一道就红）。
  for (const [slug, cap] of Object.entries(GROUP_CAPS)) {
    if (!files.includes(`${slug}.json`)) continue;
    const arr = JSON.parse(await readFile(join(dataDir, `${slug}.json`), 'utf8'));
    if (arr.length > cap) {
      problems.push(`${slug}.json: ${arr.length} 道，超过例外组上限 ${cap} 道——「${GROUPS[slug]}」是有上限的组，加菜先改 GROUP_CAPS 和三处文档`);
    }
  }

  console.log(`文件 ${files.length} 个，菜品 ${total} 道，菜系 ${byCuisine.size} 组`);
  for (const [k, v] of [...byCuisine].sort()) console.log(`  ${k}  ${v} 道`);

  if (problems.length) {
    console.log(`\n❌ ${problems.length} 个问题：`);
    for (const p of problems) console.log(`  · ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ 全部通过');
  }
}

function count(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

if (process.argv[1] && process.argv[1].endsWith('validate-dishes.mjs')) {
  await main();
}
