/**
 * check-batch.mjs —— 校验 `.incoming/` 里某一个批次文件（分批写菜时 agent 的自查工具）。
 *
 * `check-file.mjs` 只认 `src/data/<组名>.json`，读不了 `.incoming/<组名>__<序号>.json`，
 * 所以 0.6.0 加了这个。
 *
 * 它比 check-file 多查两样，都是为了防「agent 写错菜」这类静默问题：
 *   1. **id 与名字必须跟编排方给的名单逐条对上**（名单在 `.incoming/plan.json`）——
 *      少写、多写、写串（把别的组的字段填进来）都会红。
 *   2. **id 不许跟 src/data 或别的批次撞**。
 *
 * 用法：node tools/check-batch.mjs sichuan__1        （自动补 .json）
 *       node tools/check-batch.mjs .incoming/sichuan__1.json
 *
 * 退出码：0 = 全过；1 = 有问题（问题逐条打印）。
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDish, GROUPS, DISH_FIELDS } from './validate-dishes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INC = join(ROOT, '.incoming');
const DATA = join(ROOT, 'src', 'data');

const arg = process.argv[2];
if (!arg) {
  console.log('用法：node tools/check-batch.mjs <组名>__<序号>（例：sichuan__1）');
  process.exit(1);
}
const name = basename(arg).replace(/\.json$/, '');
const slug = name.split('__')[0];

const problems = [];
let arr;
try {
  arr = JSON.parse((await readFile(join(INC, `${name}.json`), 'utf8')).replace(/^\uFEFF/, ''));
} catch (err) {
  console.log(`✗ .incoming/${name}.json 读不出来：${err.message}`);
  process.exit(1);
}
if (!Array.isArray(arr)) {
  console.log(`✗ .incoming/${name}.json 顶层不是数组`);
  process.exit(1);
}

const want = GROUPS[slug];
if (!want) problems.push(`文件名前缀 ${slug} 不在 GROUPS 映射里`);

// ── 1. 逐道查契约 ──
arr.forEach((dish, i) => {
  const where = `${name}.json[${i}]`;
  checkDish(dish, where, problems);
  if (want && dish?.cuisine !== want) {
    problems.push(`${where}: cuisine 是「${dish?.cuisine}」，应为「${want}」`);
  }
});

// ── 2. 跟名单对账 ──
let plan = null;
if (existsSync(join(INC, 'plan.json'))) {
  const all = JSON.parse(await readFile(join(INC, 'plan.json'), 'utf8'));
  plan = (all.batches ?? []).find((b) => b.file === name);
}
if (!plan) {
  problems.push(`.incoming/plan.json 里没有 ${name} 这一批——文件名是不是算错了？`);
} else {
  const wantIds = plan.dishes.map((d) => d.id);
  const gotIds = arr.map((d) => d?.id);
  const lack = wantIds.filter((id) => !gotIds.includes(id));
  const over = gotIds.filter((id) => !wantIds.includes(id));
  if (lack.length) problems.push(`少了名单上的：${lack.join('、')}`);
  if (over.length) problems.push(`多出名单外的：${over.join('、')}`);
  if (new Set(gotIds).size !== gotIds.length) problems.push('本文件里 id 有重复');
  // 名字、region、category 也照名单核（这三栏是编排方定的，agent 不许改）
  for (const p of plan.dishes) {
    const d = arr.find((x) => x?.id === p.id);
    if (!d) continue;
    if (d.name !== p.name) problems.push(`${p.id}: 名字是「${d.name}」，名单上是「${p.name}」`);
    if (d.category !== p.category) problems.push(`${p.id}: category 是「${d.category}」，名单上是「${p.category}」`);
    if (d.region !== p.region) problems.push(`${p.id}: region 是「${d.region}」，名单上是「${p.region}」`);
  }
}

// ── 3. 全库查重 ──
const seen = new Map();
for (const f of (await readdir(DATA)).filter((x) => x.endsWith('.json'))) {
  try {
    for (const d of JSON.parse((await readFile(join(DATA, f), 'utf8')))) seen.set(d.id, `src/data/${f}`);
  } catch { /* 坏文件交给全库校验去报 */ }
}
for (const f of (await readdir(INC)).filter((x) => x.endsWith('.json') && x !== 'plan.json')) {
  try {
    for (const d of JSON.parse((await readFile(join(INC, f), 'utf8')))) {
      if (f === `${name}.json`) continue;
      if (seen.has(d.id)) seen.set(d.id, `${seen.get(d.id)} + ${f}`);
      else seen.set(d.id, f);
    }
  } catch { /* 半成品不判 */ }
}
for (const d of arr) {
  const where = seen.get(d?.id);
  if (where && !where.endsWith(`/${name}.json`) && where !== name) {
    problems.push(`${d.id}: id 跟 ${where} 撞了`);
  }
}

const cats = [...new Set(arr.map((d) => d?.category))].join('/');
console.log(`${name}.json：${arr.length} 道，菜系「${want ?? '?'}」，类别 ${cats}`);
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
  console.log('\n✅ 这个批次通过');
}