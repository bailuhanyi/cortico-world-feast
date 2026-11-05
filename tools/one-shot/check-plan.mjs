/**
 * check-plan.mjs —— 对账：每组「旧库 + incoming」是不是正好到目标数。
 *
 * 这一轮踩过的坑：批次文件名算错 startAt，两个 agent 写了同一个文件，
 * 前一批的菜被后一批**悄悄覆盖**，总数少了 10 道却没有任何报错。
 * 所以这里按组对账，差一道就红。
 */
import { readdir, readFile } from 'node:fs/promises';

/** 0.5.0 的目标：24 组 / 500 道。中餐 300 + 外餐 200。 */
export const TARGET = {
  sichuan: 32, cantonese: 32, 'jiangzhe-hu': 30, northern: 30, hunan: 24,
  southwest: 24, northeast: 24, northwest: 28, 'fujian-taiwan': 26, shandong: 24, hubei: 26,
  japanese: 28, korean: 15, 'southeast-asian': 17, 'south-asian': 15, mexican: 15,
  italian: 15, french: 15, european: 18, 'anglo-american': 15, 'middle-eastern': 15,
  'latin-american': 12, 'eastern-european': 10, african: 10,
};

const countJson = async (path) => {
  try {
    const a = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
    return Array.isArray(a) ? a.length : -1;
  } catch { return 0; }
};

const oldCount = {};
for (const f of (await readdir('src/data')).filter((x) => x.endsWith('.json'))) {
  oldCount[f.replace(/\.json$/, '')] = await countJson(`src/data/${f}`);
}

const incCount = {};
for (const f of (await readdir('.incoming')).filter((x) => x.endsWith('.json'))) {
  const slug = f.split('__')[0];
  incCount[slug] = (incCount[slug] ?? 0) + (await countJson(`.incoming/${f}`));
}

let bad = 0;
let sumOld = 0;
let sumInc = 0;
console.log('组'.padEnd(18) + '现有  incoming   合计 / 目标');
for (const [slug, target] of Object.entries(TARGET)) {
  const o = oldCount[slug] ?? 0;
  const i = incCount[slug] ?? 0;
  sumOld += o;
  sumInc += i;
  const total = o + i;
  const ok = total === target;
  if (!ok) bad += 1;
  console.log(
    `${slug.padEnd(18)}${String(o).padStart(4)}${String(i).padStart(10)}${String(total).padStart(8)} / ${target}  ${ok ? '✓' : `✗ 差 ${target - total}`}`,
  );
}

console.log(`\n合计：旧库 ${sumOld} + incoming ${sumInc} = ${sumOld + sumInc}，目标 ${Object.values(TARGET).reduce((a, b) => a + b, 0)}`);
const extra = Object.keys(oldCount).filter((k) => !(k in TARGET));
if (extra.length) console.log(`⚠ src/data 里有不在目标表的文件：${extra.join('、')}`);
if (bad) { console.log(`❌ ${bad} 组没对上`); process.exitCode = 1; } else console.log('✅ 每组都对上了');
