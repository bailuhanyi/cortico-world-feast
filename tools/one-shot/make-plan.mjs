/**
 * make-plan.mjs —— 0.6.0：把 roster-0-6-0.json 切成批次，写 `.incoming/plan.json`。
 *
 * **文件名必须由编排方一次性算准。** 0.5.0 就是这里错了：两个 agent 写了同一个
 * `.incoming/<组名>__<序号>.json`，后一批把前一批整个覆盖，少 10 道却零报错。
 * 所以这里的 `file` 字段是唯一权威——派活时照抄，不许自己拼。
 *
 * 用法：node tools/one-shot/make-plan.mjs [每批最多几道，默认 8]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { GROUPS } from '../validate-dishes.mjs';

const PER = Number(process.argv[2] ?? 8);
const roster = JSON.parse(await readFile('tools/one-shot/roster-0-6-0.json', 'utf8'));

if (!existsSync('.incoming')) await mkdir('.incoming');

const bySlug = new Map();
for (const d of roster) {
  if (!bySlug.has(d.slug)) bySlug.set(d.slug, []);
  bySlug.get(d.slug).push(d);
}

const batches = [];
for (const [slug, list] of bySlug) {
  if (!GROUPS[slug]) { console.log(`✗ roster 里的组 ${slug} 不在 GROUPS 里`); process.exit(1); }
  const n = Math.ceil(list.length / PER);
  for (let i = 0; i < n; i += 1) {
    const dishes = list.slice(i * PER, (i + 1) * PER)
      .map((d) => ({ id: d.id, name: d.name, region: d.region, category: d.category }));
    batches.push({
      file: `${slug}__${i + 1}`,
      slug,
      cuisine: GROUPS[slug],
      count: dishes.length,
      dishes,
    });
  }
}

const plan = {
  version: '0.6.0',
  total: roster.length,
  perBatch: PER,
  batches,
};
await writeFile('.incoming/plan.json', `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

// 对账：名单加起来必须等于 roster，且文件名不许重复
const ids = new Set(batches.flatMap((b) => b.dishes.map((d) => d.id)));
const files = new Set(batches.map((b) => b.file));
console.log(`批次 ${batches.length} 个，菜 ${ids.size} 道（roster ${roster.length} 道）`);
if (ids.size !== roster.length) { console.log('✗ 批次合起来跟 roster 对不上'); process.exit(1); }
if (files.size !== batches.length) { console.log('✗ 批次文件名有重复'); process.exit(1); }
console.log('批次文件名：');
for (const b of batches) console.log(`  ${b.file.padEnd(24)} ${String(b.count).padStart(2)} 道  ${b.cuisine}`);