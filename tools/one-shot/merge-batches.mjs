/**
 * merge-batches.mjs —— 0.6.0：把 `.incoming/<组名>__<序号>.json` 并进 `src/data/<组名>.json`。
 *
 * 比 0.5.0 的 merge-incoming 严一点：
 *   · **先按 plan.json 对账**，少一道、多一道、批次文件缺失就整批拒绝、一个文件都不写；
 *   · 只许往组文件尾部追加，不动已有条目（不重排、不改旧数据）；
 *   · 同一道菜并入两次会按 id 拒掉并报出来（不是悄悄丢）。
 *
 * 用法：node tools/one-shot/merge-batches.mjs [--dry]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const plan = JSON.parse(await readFile('.incoming/plan.json', 'utf8'));

const problems = [];
const bySlug = new Map();

for (const b of plan.batches) {
  const path = `.incoming/${b.file}.json`;
  if (!existsSync(path)) { problems.push(`缺批次文件 ${path}`); continue; }
  let arr;
  try {
    arr = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (err) { problems.push(`${path} 解析失败：${err.message}`); continue; }
  if (!Array.isArray(arr)) { problems.push(`${path} 顶层不是数组`); continue; }
  if (arr.length !== b.count) {
    problems.push(`${path}: ${arr.length} 道，名单上是 ${b.count} 道`);
  }
  const wantIds = b.dishes.map((d) => d.id);
  const gotIds = arr.map((d) => d?.id);
  const lack = wantIds.filter((id) => !gotIds.includes(id));
  if (lack.length) problems.push(`${path}: 少了 ${lack.join('、')}`);
  const over = gotIds.filter((id) => !wantIds.includes(id));
  if (over.length) problems.push(`${path}: 多出 ${over.join('、')}`);
  bySlug.set(b.slug, [...(bySlug.get(b.slug) ?? []), ...arr]);
}

if (problems.length) {
  console.log(`❌ ${problems.length} 处对不上，一个文件都没动：`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

let added = 0;
for (const [slug, incoming] of [...bySlug].sort()) {
  const path = `src/data/${slug}.json`;
  const existing = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : [];
  const ids = new Set(existing.map((d) => d.id));
  const names = new Set(existing.map((d) => d.name));
  const before = existing.length;
  for (const d of incoming) {
    if (ids.has(d.id)) { console.log(`  ✗ 丢：id 已存在 ${d.id}（${d.name}）`); continue; }
    if (names.has(d.name)) { console.log(`  ✗ 丢：重名 ${d.name}`); continue; }
    existing.push(d);
    ids.add(d.id);
    names.add(d.name);
  }
  if (!DRY) await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  added += existing.length - before;
  console.log(`· ${slug.padEnd(20)} ${String(before).padStart(2)} → ${String(existing.length).padStart(2)} 道（+${existing.length - before}${DRY ? '，dry' : ''}）`);
}
console.log(`\n并入 ${added} 道${DRY ? '（--dry，没写盘）' : ''}`);