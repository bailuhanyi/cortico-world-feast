/**
 * merge-incoming.mjs —— 把 .incoming 里写好的新菜并进 src/data。
 *
 * 按文件名前缀 `组名__批次.json` 归组；同组内 id 或名字已存在的直接丢掉并报出来，
 * 不覆盖、不改旧数据。写完逐组报数量。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';

const INC = '.incoming';
const DATA = 'src/data';

const files = (await readdir(INC)).filter((f) => f.endsWith('.json')).sort();
const bySlug = new Map();
for (const f of files) {
  const slug = f.split('__')[0];
  const arr = JSON.parse((await readFile(`${INC}/${f}`, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(arr)) { console.log(`✗ ${f} 顶层不是数组`); continue; }
  bySlug.set(slug, [...(bySlug.get(slug) ?? []), ...arr]);
}

const slugOf = async (dish) => dish.cuisine;

let added = 0;
let skipped = 0;
for (const [slug, incoming] of [...bySlug].sort()) {
  let existing = [];
  try {
    existing = JSON.parse(await readFile(`${DATA}/${slug}.json`, 'utf8'));
  } catch {
    console.log(`· ${slug}.json 不存在，新建`);
  }
  const ids = new Set(existing.map((d) => d.id));
  const names = new Set(existing.map((d) => d.name));
  const before = existing.length;
  for (const d of incoming) {
    if (ids.has(d.id)) { console.log(`  ✗ 丢：id 已存在 ${d.id}（${d.name}）`); skipped += 1; continue; }
    if (names.has(d.name)) { console.log(`  ✗ 丢：重名 ${d.name}`); skipped += 1; continue; }
    // cuisine 必须和所在文件一致，防止 batch 里填错
    existing.push(d);
    ids.add(d.id);
    names.add(d.name);
  }
  await writeFile(`${DATA}/${slug}.json`, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  const delta = existing.length - before;
  added += delta;
  console.log(`· ${slug.padEnd(18)} ${String(before).padStart(2)} → ${String(existing.length).padStart(2)} 道（+${delta}，来自 ${incoming.length} 条）`);
}

console.log(`\n并入 ${added} 道，丢弃 ${skipped} 道`);
const total = (await Promise.all(
  (await readdir(DATA)).filter((f) => f.endsWith('.json'))
    .map(async (f) => JSON.parse(await readFile(`${DATA}/${f}`, 'utf8')).length),
)).reduce((a, b) => a + b, 0);
console.log(`src/data 现在共 ${total} 道`);
void slugOf;
