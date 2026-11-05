/**
 * check-plan.mjs —— 按组对账：每组「旧库（+ incoming）」是不是正好到目标数。
 *
 * 这一轮踩过的坑：批次文件名算错（startAt），两个 agent 写了同一个文件，
 * 前一批的菜被后一批**悄悄覆盖**，总数少了 10 道却没有任何报错。
 * 所以这里按组对账，差一道就红。
 *
 * 两版目标表都在：默认按**当前版本**（0.6.0）对账，`--v=0.5.0` 看上一版。
 * 合并前带 incoming 一起算（`node tools/one-shot/check-plan.mjs` 那时 .incoming 还在），
 * 合并后 .incoming 已经清空，就只看库里。
 */
import { readdir, readFile } from 'node:fs/promises';

/** 0.6.0 的目标：28 组 / 701 道（700 道地域菜 + 白米饭 1 道）。中餐 420 + 外餐 280。 */
export const TARGET_0_6_0 = {
  sichuan: 40, cantonese: 40, 'jiangzhe-hu': 38, northern: 38, hunan: 30, southwest: 32,
  northeast: 28, northwest: 34, 'fujian-taiwan': 32, shandong: 30, hubei: 30,
  anhui: 24, jiangxi: 24,
  japanese: 34, korean: 19, 'southeast-asian': 26, 'south-asian': 21, mexican: 19,
  italian: 23, french: 21, 'southern-european': 19, 'central-european': 17,
  'anglo-american': 19, 'middle-eastern': 18, 'latin-american': 15,
  'eastern-european': 15, african: 14,
  staples: 1,
};

/** 0.5.0 的目标：24 组 / 500 道。中餐 300 + 外餐 200。 */
export const TARGET_0_5_0 = {
  sichuan: 32, cantonese: 32, 'jiangzhe-hu': 30, northern: 30, hunan: 24,
  southwest: 24, northeast: 24, northwest: 28, 'fujian-taiwan': 26, shandong: 24, hubei: 26,
  japanese: 28, korean: 15, 'southeast-asian': 17, 'south-asian': 15, mexican: 15,
  italian: 15, french: 15, european: 18, 'anglo-american': 15, 'middle-eastern': 15,
  'latin-american': 12, 'eastern-european': 10, african: 10,
};

const WANT = process.argv.find((a) => a.startsWith('--v='))?.slice(4) ?? '0.6.0';
const TARGET = WANT === '0.5.0' ? TARGET_0_5_0 : TARGET_0_6_0;

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

// 合并前这里还有批次文件；合并后（含分批写菜的收口阶段）目录里只剩归档子目录，算 0。
const incCount = {};
try {
  for (const f of (await readdir('.incoming')).filter((x) => x.endsWith('.json'))) {
    const slug = f.split('__')[0];
    incCount[slug] = (incCount[slug] ?? 0) + (await countJson(`.incoming/${f}`));
  }
} catch { /* 没有 .incoming 就算没有待合并的 */ }

let bad = 0;
let sumOld = 0;
let sumInc = 0;
console.log(`目标版本 ${WANT}\n组${' '.repeat(13)}现有  incoming     合计 / 目标`);
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

const goal = Object.values(TARGET).reduce((a, b) => a + b, 0);
console.log(`\n合计：旧库 ${sumOld} + incoming ${sumInc} = ${sumOld + sumInc}，目标 ${goal}`);
const extra = Object.keys(oldCount).filter((k) => !(k in TARGET) && oldCount[k] > 0);
if (extra.length) console.log(`⚠ src/data 里有不在目标表的文件：${extra.join('、')}`);
if (bad) { console.log(`❌ ${bad} 组没对上`); process.exitCode = 1; } else console.log('✅ 每组都对上了');