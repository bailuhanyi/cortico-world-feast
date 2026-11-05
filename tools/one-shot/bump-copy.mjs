/**
 * bump-copy.mjs —— 0.6.0：升版本号，并把文案里的「500 道 / 24 个菜系组」改成「701 道 / 28 个菜系组」。
 *
 * 一次性的：跑完就删。改的是 package.json 的 version / description / cortico.locales。
 */
import { readFile, writeFile } from 'node:fs/promises';

const path = 'package.json';
const pkg = JSON.parse(await readFile(path, 'utf8'));

const NEW_VERSION = '0.6.0';
const swap = (s) => (typeof s === 'string'
  ? s.replace(/500 道菜/g, '701 道菜').replace(/500 道/g, '701 道')
    .replace(/24 个菜系组/g, '28 个菜系组').replace(/24 个菜系/g, '28 个菜系')
    .replace(/500 dishes/g, '701 dishes').replace(/24 cuisines/g, '28 cuisines')
  : s);

const next = {
  ...pkg,
  version: NEW_VERSION,
  description: swap(pkg.description),
  cortico: {
    ...pkg.cortico,
    locales: Object.fromEntries(Object.entries(pkg.cortico.locales).map(([k, v]) => [k, {
      ...v,
      description: swap(v.description),
    }])),
  },
};

await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`version → ${NEW_VERSION}`);
console.log('description →', next.description);
for (const [k, v] of Object.entries(next.cortico.locales)) console.log(k, '→', v.description.slice(0, 60), '…');