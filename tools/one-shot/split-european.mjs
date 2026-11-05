/**
 * split-european.mjs —— 0.6.0：`european.json`（欧洲菜 18 道）拆成
 * `southern-european.json`（南欧菜）+ `central-european.json`（中欧菜），删掉旧文件。
 *
 * 按地理拆，不按形态拆：南欧 = 西班牙、葡萄牙、希腊；中欧 = 德国、奥地利、比利时、荷兰、瑞士。
 *
 * **MOVE 表逐道写明**：库里每一道都必须在这张表上，多一道、少一道都整批拒绝执行、不写盘。
 * 这是 0.3.0/0.4.0 的规矩——迁移脚本最怕的不是报错，是悄悄漏一道。
 *
 * 用法：node tools/one-shot/split-european.mjs [--dry]
 *   跑完就删了它（数据已经不是迁移前的样子，重跑只会报错）。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');

/** 逐道写明去向。键是 id，值是目标组 slug。 */
const MOVE = {
  // —— 南欧菜：西班牙 / 葡萄牙 / 希腊 ——
  'paella': 'southern-european',
  'gazpacho': 'southern-european',
  'gambas-al-ajillo': 'southern-european',
  'jamon-con-melon': 'southern-european',
  'tortilla-espanola': 'southern-european',
  'churros-con-chocolate': 'southern-european',
  'basque-burnt-cheesecake': 'southern-european',
  'pastel-de-nata': 'southern-european',
  'sardinhas-assadas': 'southern-european',
  'pork-clams-alentejo': 'southern-european',
  'greek-salad': 'southern-european',
  'moussaka': 'southern-european',
  // —— 中欧菜：德国 / 奥地利 / 比利时 / 荷兰 / 瑞士 ——
  'hot-chocolate': 'central-european',        // 布鲁塞尔
  'black-forest-cake': 'central-european',    // 德国黑森林
  'crispy-fries': 'central-european',         // 比利时布鲁塞尔
  'schweinshaxe': 'central-european',         // 德国慕尼黑
  'nuernberger-rostbratwuerste': 'central-european', // 德国纽伦堡
  'wiener-schnitzel': 'central-european',     // 奥地利维也纳
};

const NAMES = { 'southern-european': '南欧菜', 'central-european': '中欧菜' };

const src = JSON.parse(await readFile('src/data/european.json', 'utf8'));

// —— 对账：库里每一道都得在表上，表上每一道也得在库里 ——
const missing = src.filter((d) => !(d.id in MOVE)).map((d) => `${d.id}（${d.name}）`);
const extra = Object.keys(MOVE).filter((id) => !src.some((d) => d.id === id));
if (missing.length || extra.length) {
  if (missing.length) console.log(`✗ 库里这些菜没写明去向：${missing.join('、')}`);
  if (extra.length) console.log(`✗ MOVE 表里这些 id 库里没有：${extra.join('、')}`);
  console.log('整批拒绝执行，一个文件都没动。');
  process.exit(1);
}

const out = { 'southern-european': [], 'central-european': [] };
for (const d of src) out[MOVE[d.id]].push({ ...d, cuisine: NAMES[MOVE[d.id]] });
// 按 cuisine 写好后保持原顺序（沿库里原有次序，不重排）。

console.log(`欧洲菜 ${src.length} 道 → 南欧菜 ${out['southern-european'].length} + 中欧菜 ${out['central-european'].length}`);
for (const [slug, arr] of Object.entries(out)) {
  console.log(`\n${NAMES[slug]}（${slug}.json）：`);
  for (const d of arr) console.log(`  · ${d.id.padEnd(30)} ${d.name}   ${d.region}`);
}

if (DRY) {
  console.log('\n（--dry，没有写盘）');
  process.exit(0);
}

if (!existsSync('src/data/european.json')) {
  console.log('✗ european.json 已经不在了，别重复跑');
  process.exit(1);
}
for (const slug of Object.keys(out)) {
  await writeFile(`src/data/${slug}.json`, `${JSON.stringify(out[slug], null, 2)}\n`, 'utf8');
}
await unlink('src/data/european.json');
console.log('\n✓ 写了 southern-european.json / central-european.json，删了 european.json');