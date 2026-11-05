/**
 * 核对 install.ps1 里写的默认值与 src/config.js 的 DEFAULTS 是否一致。
 *
 * 这两处是同一个东西的两个副本：脚本写进 config.json，代码在 keys 缺失时按 DEFAULTS 兜底。
 * 一旦漂开，装完读到的值和面板上显示的值就是两回事。
 *
 * 用法：node tools/check-install.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ps1 = readFileSync(join(ROOT, 'install.ps1'), 'utf8');
const { DEFAULTS } = await import(pathToFileURL(join(ROOT, 'src', 'config.js')).href);

// 必须 UTF-8 with BOM：Windows PowerShell 5.1 读无 BOM 的 UTF-8 会按 GBK 解，中文全乱。
const bytes = readFileSync(join(ROOT, 'install.ps1'));
const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

const block = ps1.match(/\$defaults = \[ordered\]@\{([\s\S]*?)\n\}/);
if (!block) {
  console.error('✗ install.ps1 里找不到 $defaults 块');
  process.exit(1);
}

const rows = [];
for (const line of block[1].split('\n')) {
  const m = line.match(/^\s{2}(\w+)\s*=\s*(.+?)\s*$/);
  if (m) rows.push([m[1], m[2]]);
}

const unquote = (raw) => {
  if (raw === '$true') return true;
  if (raw === '$false') return false;
  const m = raw.match(/^'(.*)'$/);
  if (m) return m[1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
};

const problems = [];
const seen = new Set();
for (const [key, raw] of rows) {
  seen.add(key);
  const scriptVal = unquote(raw);
  if (key === 'enabled') {
    // enabled 由部署决定，脚本恒写 true；DEFAULTS 里恒 false。
    if (scriptVal !== true) problems.push(`enabled 在脚本里是 ${scriptVal}，应为 $true`);
    continue;
  }
  if (!(key in DEFAULTS)) {
    problems.push(`脚本里有 ${key}，但 DEFAULTS 里没有这一项`);
    continue;
  }
  if (scriptVal !== DEFAULTS[key]) {
    problems.push(`${key}：脚本写 ${JSON.stringify(scriptVal)}，代码兜底 ${JSON.stringify(DEFAULTS[key])}`);
  }
}
for (const key of Object.keys(DEFAULTS)) {
  if (key !== 'enabled' && !seen.has(key)) problems.push(`DEFAULTS 有 ${key}，脚本没写（装完这一项会缺失）`);
}

if (!hasBom) problems.push('install.ps1 没有 UTF-8 BOM：Windows PowerShell 5.1 会把中文按 GBK 解成乱码');

console.log(`  ✓ install.ps1 是 UTF-8 with BOM`);
console.log(`  ✓ 脚本 $defaults ${rows.length} 项 vs DEFAULTS ${Object.keys(DEFAULTS).length} 项`);
for (const p of problems) console.log(`  ✗ ${p}`);
console.log(problems.length ? `\n${problems.length} 处不一致` : '\n全部一致');
if (problems.length) process.exitCode = 1;