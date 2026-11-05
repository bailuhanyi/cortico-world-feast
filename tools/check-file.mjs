/**
 * check-file.mjs —— 只校验一个菜品 json，给分批写菜的 agent 自查用。
 *
 * 和 validate-dishes.mjs 用同一套契约（直接复用它的 checkDish / GROUPS），
 * 区别只是不看别的文件——并发写菜时别人的半成品不该把自己判红。
 *
 * 用法：node tools/check-file.mjs sichuan          （自动补 .json）
 *       node tools/check-file.mjs src/data/sichuan.json
 *
 * 退出码：0 = 全过；1 = 有问题（问题逐条打印）。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDish, GROUPS, DISH_FIELDS } from './validate-dishes.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

const arg = process.argv[2];
if (!arg) {
  console.log('用法：node tools/check-file.mjs <组名>（例：sichuan / northwest）');
  process.exit(1);
}
const slug = basename(arg).replace(/\.json$/, '');

const problems = [];
let arr;
try {
  arr = JSON.parse(await readFile(join(DATA, `${slug}.json`), 'utf8'));
} catch (err) {
  console.log(`✗ ${slug}.json 读不出来：${err.message}`);
  process.exit(1);
}
if (!Array.isArray(arr)) {
  console.log(`✗ ${slug}.json 顶层不是数组`);
  process.exit(1);
}

const want = GROUPS[slug];
if (!want) problems.push(`文件名 ${slug} 不在 GROUPS 映射里`);

const seen = new Set();
arr.forEach((dish, i) => {
  const where = `${slug}.json[${i}]`;
  const id = checkDish(dish, where, problems);
  if (id) {
    if (seen.has(id)) problems.push(`${where}: 本文件内 id 重复（${id}）`);
    seen.add(id);
  }
  if (want && dish?.cuisine !== want) {
    problems.push(`${where}: cuisine 是「${dish?.cuisine}」，应为「${want}」`);
  }
});

const cats = [...new Set(arr.map((d) => d?.category))].join('/');
console.log(`${slug}.json：${arr.length} 道，菜系「${want ?? '?'}」，类别 ${cats}`);
for (const d of arr) {
  const n = typeof d?.prose === 'string' ? d.prose.replace(/\s/g, '').length : 0;
  const fields = DISH_FIELDS.filter((f) => !(f in (d ?? {}))).length;
  console.log(`  · ${String(d?.id).padEnd(28)} ${String(d?.name).padEnd(10)} prose ${String(n).padStart(3)} 字${fields ? `  缺 ${fields} 字段` : ''}`);
}

if (problems.length) {
  console.log(`\n❌ ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n✅ 这个文件通过');
}