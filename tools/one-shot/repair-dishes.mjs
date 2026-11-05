/**
 * repair-dishes.mjs —— 把首批生成里跑偏的地方改回契约（可重复跑，改过就跳过）。
 *
 * 这批修的是：
 *   · italian.json 开头带了 UTF-8 BOM，JSON.parse 直接失败；
 *   · ice.json 和 desserts.json 各有一道 vanilla-ice-cream，重复 id 只留冰品那道，
 *     甜品那道换成另一道真的甜品；
 *   · bbq / western 有 3 处 ingredients 写了 7 样（契约是 3-6），各去掉一样冗余的；
 *   · northern.json 的炒肝 prose 里出现了套话「让人」。
 *
 * 用法：node tools/repair-dishes.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const BOM = '\uFEFF';

/** 各文件里要摘掉的食材（第一处匹配）。 */
const DROP_INGREDIENT = {
  'bbq.json': ['火腿肠'],
  'western.json': ['法棍丁', '百里香'],
};

/** 文本替换：套话。 */
const TEXT_FIXES = [
  {
    file: 'northern.json',
    id: 'chao-gan',
    from: '糊嘴的油让人想停一下。',
    to: '糊嘴的油顶上来了，得停一下。',
  },
];

/** 重复 id 时，甜品那道换成这个。 */
const REPLACE_DESSERT = {
  id: 'creme-brulee',
  name: '焦糖布丁',
  alias: 'Crème Brûlée',
  cuisine: '甜品',
  category: '甜品',
  region: '巴黎',
  ingredients: ['淡奶油', '蛋黄', '香草荚', '细砂糖'],
  method: '淡奶油剖进香草荚，小火加热到将沸，离火焖十分钟让香草出味。蛋黄加细砂糖搅到发白，把温奶油缓缓冲进去，边冲边搅，过筛两遍撇掉浮沫。倒进浅口烤碗，水浴 150℃ 烤到中心轻晃还留一点流动，取出冷藏四小时定形。上桌前撒一层薄细砂糖，喷枪快速烧到糖化起壳——火要快，慢了底下那层布丁就热了。',
  serving: '从冷藏里端出来，碗壁还挂着水汽，糖壳是琥珀色的，勺子敲上去是脆响。',
  taste: { 辣: 0, 麻: 0, 咸: 8, 鲜: 14, 甜: 78, 酸: 4, 苦: 12, 油: 42, 香: 72 },
  texture: '勺子敲破糖壳是脆的，底下的布丁软到几乎不用牙，舌头一压就化开。',
  aroma: '先闻到烧糖的焦香，挖开之后是香草和蛋奶的甜气。',
  finish: '咽下去舌面上留一点焦糖的微苦，嘴里是奶油味，凉的。',
  prose: '勺子横着敲下去，糖壳先咔地裂开一道，碎渣粘在布丁上一起送进嘴，第一口是脆的和软的隔着牙碰在一起。糖壳的焦苦压在前头，紧接着蛋奶的甜从底下涌上来，香草籽在牙缝里留了一点黑。吃到一半糖壳被挖得七零八落，剩下的布丁没有壳护着，甜得更直接，也腻得更快。碗底那层刮不起来了，用勺子顺着碗壁刮两下，把最后一点带着碎糖的奶油送进嘴，凉的，收在一点焦苦上。',
  keywords: ['冰凉', '焦糖脆壳', '蛋奶', '收尾'],
};

async function load(file) {
  const raw = await readFile(join(DATA, file), 'utf8');
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return { text, bom: raw.startsWith(BOM), arr: JSON.parse(text) };
}

async function save(file, arr) {
  await writeFile(join(DATA, file), `${JSON.stringify(arr, null, 2)}\n`, 'utf8');
}

let changed = 0;

// 1. BOM
for (const file of ['italian.json']) {
  try {
    const raw = await readFile(join(DATA, file), 'utf8');
    if (!raw.startsWith(BOM)) { console.log(`· ${file} 没有 BOM，跳过`); continue; }
    const arr = JSON.parse(raw.slice(1));
    await save(file, arr);
    changed += 1;
    console.log(`✓ ${file} 去掉了 BOM（${arr.length} 道）`);
  } catch (err) {
    console.log(`✗ ${file} 处理失败：${err.message}`);
  }
}

// 2. 摘掉多余的食材
for (const [file, names] of Object.entries(DROP_INGREDIENT)) {
  const { arr } = await load(file);
  let n = 0;
  for (const dish of arr) {
    if (!Array.isArray(dish.ingredients) || dish.ingredients.length <= 6) continue;
    for (const name of names.slice()) {
      const i = dish.ingredients.indexOf(name);
      if (i >= 0 && dish.ingredients.length > 6) {
        dish.ingredients.splice(i, 1);
        names.splice(names.indexOf(name), 1);
        n += 1;
      }
    }
  }
  if (n) {
    await save(file, arr);
    changed += 1;
    console.log(`✓ ${file} 摘掉 ${n} 样多余的食材`);
  } else {
    console.log(`· ${file} 没有超过 6 样的食材，跳过`);
  }
}

// 3. 套话
for (const fix of TEXT_FIXES) {
  const { arr } = await load(fix.file);
  const dish = arr.find((d) => d.id === fix.id);
  if (!dish) { console.log(`· ${fix.file} 里没有 ${fix.id}，跳过`); continue; }
  if (!dish.prose.includes(fix.from)) { console.log(`· ${fix.file} 的 ${fix.id} 已经改过，跳过`); continue; }
  dish.prose = dish.prose.replaceAll(fix.from, fix.to);
  await save(fix.file, arr);
  changed += 1;
  console.log(`✓ ${fix.file} 的 ${fix.id} 换掉了套话`);
}

// 4. 重复 id：甜品那道换掉
{
  const { arr } = await load('desserts.json');
  const i = arr.findIndex((d) => d.id === 'vanilla-ice-cream');
  if (i < 0) {
    console.log('· desserts.json 里已经没有重复的香草冰淇淋，跳过');
  } else if (arr.some((d) => d.id === REPLACE_DESSERT.id)) {
    console.log('· 焦糖布丁已经在库里，跳过');
  } else {
    arr[i] = REPLACE_DESSERT;
    await save('desserts.json', arr);
    changed += 1;
    console.log('✓ desserts.json 的香草冰淇淋换成了焦糖布丁（冰品那边保留）');
  }
}

console.log(changed ? `\n改了 ${changed} 处。跑 node tools/validate-dishes.mjs 复查。` : '\n没有要改的。');
