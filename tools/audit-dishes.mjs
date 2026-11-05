/**
 * audit-dishes.mjs —— 结构之外的体检：重名、起手句撞车、分值跟类别矛盾、region 空话。
 *
 * `validate-dishes.mjs` 管的是「字段齐不齐、字数够不够」；这里查的是它查不出来的东西。
 * 加完一批菜就跑一遍。只看 src/data；如果还有 .incoming 目录（分批写作时的暂存），
 * 也一起算进去，这样合并前就能发现重名。
 *
 * 用法：node tools/audit-dishes.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const load = async (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json'))) {
    try {
      const a = JSON.parse((await readFile(`${dir}/${f}`, 'utf8')).replace(/^\uFEFF/, ''));
      if (Array.isArray(a)) out.push({ file: f, dishes: a });
    } catch (err) {
      console.log(`✗ ${f} 解析失败：${err.message}`);
    }
  }
  return out;
};

const oldFiles = await load('src/data');
const newFiles = await load('.incoming');
const all = [...oldFiles, ...newFiles].flatMap((f) => f.dishes.map((d) => ({ ...d, _file: f.file })));
console.log(`共 ${all.length} 道（src/data ${oldFiles.flatMap((f) => f.dishes).length}${newFiles.length ? ` + .incoming ${newFiles.flatMap((f) => f.dishes).length}` : ''}）\n`);

let problems = 0;

// ── 1. 重 id / 重名 ──
const ids = new Map();
const names = new Map();
for (const d of all) {
  if (ids.has(d.id)) { console.log(`✗ id 重复：${d.id}（${ids.get(d.id)} / ${d._file}）`); problems += 1; }
  else ids.set(d.id, d._file);
  const k = `${d.cuisine}|${d.name}`;
  if (names.has(k)) { console.log(`✗ 同名：${d.name}（${d.cuisine}）出现两次`); problems += 1; }
  names.set(k, 1);
}

// ── 2. prose 起手句同组撞车 ──
const byCui = new Map();
for (const d of all) {
  if (!byCui.has(d.cuisine)) byCui.set(d.cuisine, []);
  byCui.get(d.cuisine).push(d);
}
console.log('\n=== prose 起手句（同组前 5 字重复）===');
let openerDup = 0;
for (const [cui, list] of [...byCui].sort()) {
  const m = new Map();
  for (const d of list) {
    const k = (d.prose ?? '').slice(0, 5);
    m.set(k, [...(m.get(k) ?? []), d.name]);
  }
  const dups = [...m].filter(([, v]) => v.length > 1);
  if (dups.length) {
    openerDup += dups.length;
    console.log(`${cui}: ` + dups.map(([k, v]) => `「${k}…」×${v.length}(${v.join('、')})`).join('  '));
  }
}
if (!openerDup) console.log('（没有）');
problems += openerDup;

// ── 3. 分值 vs 类别 ──
console.log('\n=== 分值可疑 ===');
// 阈值故意松：马赛鱼汤带蒜香蛋黄酱（油 72）、夫妻肺片是红油凉菜（油 78）、
// 拔丝地瓜就是纯糖（甜 90）——都是对的，不该判红。这里只抓明显写反的。
const V = { 甜品甜下限: 45, 汤羹油上限: 80, 凉菜油上限: 88, 甜上限: 95, 油上限: 92 };
const suspicious = [];
for (const d of all) {
  const t = d.taste ?? {};
  if (d.category === '甜品' && (t.甜 ?? 0) < V.甜品甜下限) suspicious.push(`${d.name}：类别甜品但甜只有 ${t.甜}`);
  if (d.category === '汤羹' && (t.油 ?? 0) > V.汤羹油上限) suspicious.push(`${d.name}：汤羹但油 ${t.油}`);
  if (d.category === '凉菜' && (t.油 ?? 0) > V.凉菜油上限) suspicious.push(`${d.name}：凉菜但油 ${t.油}`);
  if ((t.辣 ?? 0) >= 60 && /甜|奶|冰|蛋糕/.test(d.name)) suspicious.push(`${d.name}：名字像甜品却辣 ${t.辣}`);
  if ((t.甜 ?? 0) > V.甜上限) suspicious.push(`${d.name}：甜 ${t.甜} 过高`);
  if ((t.油 ?? 0) > V.油上限) suspicious.push(`${d.name}：油 ${t.油} 过高`);
}
console.log(suspicious.length ? suspicious.map((s) => '  · ' + s).join('\n') : '（没有）');
problems += suspicious.length;

// ── 4. region 空话 ──
console.log('\n=== region 空话 ===');
const VAGUE = ['中国', '家里', '街边', '各地', '老家', '人家'];
const badRegion = all.filter((d) => {
  const r = d.region ?? '';
  // 「辽宁沈阳兴顺夜市」是真地名，不能因为带"夜市"就判红；
  // 判据是：整串里有没有把地点让给一个含糊的占位词。
  return VAGUE.some((v) => r.includes(v)) || r === '夜市';
});
console.log(badRegion.length ? badRegion.map((d) => `  · ${d.name}：${d.region}`).join('\n') : '（没有）');
problems += badRegion.length;

// ── 5. 每组类别分布 ──
console.log('\n=== 每组类别分布 ===');
for (const [cui, list] of [...byCui].sort()) {
  const c = {};
  for (const d of list) c[d.category] = (c[d.category] ?? 0) + 1;
  const kinds = Object.keys(c).length;
  const line = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ');
  console.log(`  ${cui.padEnd(6)} ${String(list.length).padStart(3)} 道  ${String(kinds).padStart(2)} 种类别  ${line}`);
}

// ── 6. prose 字数 ──
const lens = all.map((d) => (d.prose ?? '').replace(/\s/g, '').length).sort((a, b) => a - b);
const over = lens.filter((n) => n > 160).length;
console.log(`\nprose 字数：最短 ${lens[0]} / 中位 ${lens[Math.floor(lens.length / 2)]} / 最长 ${lens[lens.length - 1]}；超过 160 字的 ${over} 道（旧数据允许，新菜应在 100-160）`);

console.log(problems ? `\n❌ ${problems} 处要修` : '\n✅ 体检通过');
if (problems) process.exitCode = 1;
