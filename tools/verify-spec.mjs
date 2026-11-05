import { readFile, readdir } from 'node:fs/promises';
import { GROUPS } from './validate-dishes.mjs';

const spec = await readFile('DISH-SPEC.md', 'utf8');
// 只认第 2 节那张表：行首是 `slug`、第二列是中文菜系名。
// 第 0 节的字段表里也有 `| \`id\` | kebab-case |` 这种行，别把它抓进来。
const rows = [...spec.matchAll(/\| `([a-z][a-z-]*)` \| (\p{Script=Han}+) \|/gu)]
  .map((m) => ({ slug: m[1], cuisine: m[2] }));
console.log(`DISH-SPEC 组表 ${rows.length} 行 / GROUPS ${Object.keys(GROUPS).length} 项`);

let bad = 0;
for (const [slug, cuisine] of Object.entries(GROUPS)) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) { console.log(`✗ DISH-SPEC 缺 ${slug}`); bad += 1; }
  else if (r.cuisine !== cuisine) { console.log(`✗ ${slug}：SPEC 写「${r.cuisine}」，代码是「${cuisine}」`); bad += 1; }
}
for (const r of rows) if (!(r.slug in GROUPS)) { console.log(`✗ SPEC 多出 ${r.slug}`); bad += 1; }

for (const f of (await readdir('src/data')).filter((x) => x.endsWith('.json'))) {
  const slug = f.replace(/\.json$/, '');
  const arr = JSON.parse(await readFile(`src/data/${f}`, 'utf8'));
  const want = GROUPS[slug];
  if (!want) { console.log(`✗ ${f} 不在 GROUPS 里`); bad += 1; continue; }
  const wrong = arr.filter((d) => d.cuisine !== want);
  if (wrong.length) { console.log(`✗ ${f}：${wrong.length} 道 cuisine 不是「${want}」（例：${wrong[0].name}=${wrong[0].cuisine}）`); bad += 1; }
}

console.log(bad ? `\n❌ ${bad} 处不一致` : `\n✓ 组表、GROUPS、${(await readdir('src/data')).filter((x) => x.endsWith('.json')).length} 个数据文件三方严格一致`);
if (bad) process.exitCode = 1;
