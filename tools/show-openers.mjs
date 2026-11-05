/**
 * show-openers.mjs —— 打印某个菜系组已有菜品的「prose 起手句」，写新菜时避开同组撞车。
 *
 * 同组十几段 prose 摆在一起，开头连着用同一个句式就成了模子（0.2.0 踩过：drinks 组
 * 8 道里 5 道都以「第一口是 X 的」开头）。audit-dishes 事后才查得出来，写之前先看一眼更快。
 *
 * 用法：node tools/show-openers.mjs sichuan [还有哪些菜名]
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const slug = process.argv[2];
if (!slug) {
  console.log('用法：node tools/show-openers.mjs <组名>');
  process.exit(1);
}
const path = `src/data/${slug}.json`;
if (!existsSync(path)) {
  console.log(`${slug}.json 还不存在（新开的组），起手句随便写，只要同批几道之间不撞。`);
  process.exit(0);
}
const arr = JSON.parse(await readFile(path, 'utf8'));
console.log(`${slug} 现有 ${arr.length} 道，已有起手句（新写的别撞）：\n`);
const heads = new Map();
for (const d of arr) {
  const head = (d.prose ?? '').slice(0, 5);
  heads.set(head, [...(heads.get(head) ?? []), d.name]);
  console.log(`  ${head}…   ${d.name}`);
}
console.log(`\n已有菜名（别重复写）：${arr.map((d) => d.name).join('、')}`);
const dup = [...heads].filter(([, v]) => v.length > 1);
if (dup.length) console.log(`\n⚠（旧数据里已经撞了的，你新写的别再撞上去）`);