/**
 * publish-check.mjs —— 模拟 Coo 扩展市场的 Action 扫描，在发 npm 之前把能查的都查掉。
 *
 * Action 的口径见索引仓 Pal-AI-Lab/cortico-extensions 的 DESIGN.md：它搜 npm 的三个关键字，
 * 解包读 `cortico` 块、`describe` 指的自描述、`CHANGELOG.md`、图标与截图，逐条填进 catalog.json。
 * 这里不联网也能把大部分问题先照出来：
 *
 *   1. 包名合法、没被占（这一步要 --online）
 *   2. cortico 块字段齐：kind / api / displayName / icon / tags / locales / describe / webUiClient
 *   3. tags 全在词表里，提示与警示标签是作者自己声明得起的
 *   4. describe.json 与代码一致，且能被市场那份 localizeDescribe 读出来
 *   5. icon / screenshots 存在、格式与体积合格
 *   6. CHANGELOG.md 有当前版本那一节的二级标题（Action 按它切段）
 *   7. npm pack 里该有的文件都在、不该有的没被打进去
 *   8. 能力摘要（工具数、事件数、两处 token 估算）按市场的算法算一遍，标出落在哪个档
 *
 * 用法：
 *   node tools/publish-check.mjs            离线自查
 *   node tools/publish-check.mjs --online   额外查 npm 上的包名是否可用
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ONLINE = process.argv.includes('--online');

const ok = [];
const warnings = [];
const failures = [];
const pass = (m) => ok.push(m);
const warn = (m) => warnings.push(m);
const fail = (m) => failures.push(m);

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const kb = (p) => statSync(join(ROOT, p)).size / 1024;

// ---------------------------------------------------------------------------
// 索引仓的词表（index.json）。词表变了要重跑 --online 那份，这里留的是快照。
// ---------------------------------------------------------------------------
const VOCAB = {
  official: ['pal-ai-world', 'corti', 'coopanion'],
  plain: ['im', 'qq', 'streaming', 'game', 'internet', 'browser', 'video', 'voice', 'computer-use',
    'real-world', 'apps', 'memory', 'companion', 'creative', 'diagnostics', 'local',
    'external-setup', 'requires-key'],
  notice: ['experimental', 'internal-state', 'requires-extension', 'high-cost', 'unofficial-api'],
  warning: ['unsafe', 'sensitive-data', 'injection-risk'],
};
const ALL_TAGS = new Set([...VOCAB.official, ...VOCAB.plain, ...VOCAB.notice, ...VOCAB.warning]);

/** DESIGN.md 里的 token 估算：中日文每字 0.6，其他字符 0.3。 */
function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * 0.6 + other * 0.3);
}

/** 市场卡片的档：工具数、工具 token、前缀 token 各有两档。 */
function tier(value, warnAt, badAt) {
  return value > badAt ? 'red' : value > warnAt ? 'yellow' : 'green';
}

// ---------------------------------------------------------------------------
// 1. package.json
// ---------------------------------------------------------------------------
const pkg = JSON.parse(read('package.json'));
const c = pkg.cortico ?? {};

if (pkg.name !== 'cortico-world-feast') fail(`包名应为 cortico-world-feast，实际 ${pkg.name}`);
else pass(`包名 ${pkg.name}@${pkg.version}`);

if (c.kind !== 'world') fail(`cortico.kind 应为 world，实际 ${JSON.stringify(c.kind)}`);
if (c.api !== 6) fail(`cortico.api 应为 6（Coo 现在的 world 契约版本），实际 ${JSON.stringify(c.api)}`);
if (pkg.type !== 'module') fail(`type 应为 module，实际 ${JSON.stringify(pkg.type)}`);
if (!c.displayName) fail('cortico.displayName 缺了：市场卡片没名字可显示');
else pass(`显示名「${c.displayName}」`);

if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('cortico-world')) {
  fail('keywords 里必须有 cortico-world：Action 就是靠这个关键字搜到包的');
} else pass(`keywords 有 cortico-world（Action 的发现关键字）`);

if (!pkg.license) warn('没写 license：市场会显示不出来');
if (!pkg.description) fail('description 缺了：市场至少要用它');
const descLen = [...(pkg.description ?? '')].length;
if (descLen > 200) warn(`顶层 description ${descLen} 字，卡片只显示两行，建议压到 120 字内`);

// locales
const locales = c.locales ?? {};
for (const lang of Object.keys(locales)) {
  if (lang !== 'zh' && lang !== 'en') fail(`cortico.locales 只认 zh 与 en，多了 ${lang}`);
}
if (!locales.zh?.displayName || !locales.zh?.description) warn('locales.zh 缺 displayName 或 description');
if (!locales.en?.displayName || !locales.en?.description) warn('locales.en 缺 displayName 或 description');
if (locales.zh && locales.en) pass('locales 中英两份齐全');

// engines / os
if (pkg.engines?.node) pass(`engines.node ${pkg.engines.node}`);
else warn('没写 engines.node');
if (pkg.os) warn(`写了 os=${JSON.stringify(pkg.os)}：市场会按它标平台、在不支持的系统上禁用安装。不确定就别写`);

// ---------------------------------------------------------------------------
// 2. tags
// ---------------------------------------------------------------------------
const tags = Array.isArray(c.tags) ? c.tags : [];
if (!tags.length) fail('cortico.tags 是空的：作者声明的标签是市场分类的主要来源');
const unknown = tags.filter((t) => !ALL_TAGS.has(t));
if (unknown.length) fail(`这些标签不在词表里，市场上不会出现：${unknown.join(', ')}`);
const official = tags.filter((t) => VOCAB.official.includes(t));
if (official.length) warn(`官方标注不能自己声明（写了也不算，要靠官方 addTags）：${official.join(', ')}`);
const declared = tags.filter((t) => ALL_TAGS.has(t));
if (declared.length) pass(`声明标签 ${declared.join(', ')}`);

// 这几个包靠 keywords 映射标签；只是想提醒一下它映射到了什么
const kwTags = (pkg.keywords ?? []).filter((k) => VOCAB.plain.includes(k));
if (kwTags.length) pass(`keywords 会自动映射成普通标签：${kwTags.join(', ')}`);

// ---------------------------------------------------------------------------
// 3. describe.json：与代码一致，且能被市场那份 localizeDescribe 读出来
// ---------------------------------------------------------------------------
if (!c.describe) fail('cortico.describe 缺了：市场只读这个文件，不执行包里的代码');
else if (!existsSync(join(ROOT, c.describe))) fail(`cortico.describe 指向的 ${c.describe} 不存在`);

let describe = null;
if (c.describe && existsSync(join(ROOT, c.describe))) {
  try {
    describe = JSON.parse(read(c.describe));
    pass(`${c.describe} 可解析`);
  } catch (err) {
    fail(`${c.describe} 不是合法 JSON：${err.message}`);
  }
}

if (describe) {
  // localizeDescribe 的口径：工具要有 name + description 字符串，事件要有 type + 可读 description
  const tools = Array.isArray(describe.tools) ? describe.tools : [];
  const events = Array.isArray(describe.events) ? describe.events : [];
  if (!tools.length) fail('describe.tools 是空的：卡片的能力摘要会留空');
  if (!events.length) warn('describe.events 是空的：市场按它列出事件');

  for (const t of tools) {
    if (typeof t.name !== 'string' || typeof t.description !== 'string') {
      fail(`describe.tools 里有一条缺 name 或 description，会被市场丢掉：${JSON.stringify(t).slice(0, 60)}`);
    }
    if (!Array.isArray(t.tags) || !t.tags.length) warn(`工具 ${t.name} 没有 tags`);
    if (t.summary && typeof t.summary !== 'string'
      && !(typeof t.summary.zh === 'string' && typeof t.summary.en === 'string')) {
      fail(`工具 ${t.name} 的 summary 既不是字符串也不是 { zh, en }，市场会丢掉它`);
    }
  }
  for (const e of events) {
    const d = e.description;
    const good = typeof d === 'string' || (d && typeof d.zh === 'string' && typeof d.en === 'string');
    if (typeof e.type !== 'string' || !good) {
      fail(`describe.events 里有一条缺 type 或 description，会被市场丢掉：${JSON.stringify(e).slice(0, 60)}`);
    }
  }

  const prompts = Array.isArray(describe.prompts) ? describe.prompts : [];
  if (!prompts.length) warn('describe.prompts 空着：市场详情里的「环境提示词」那栏会没有');
  const env = prompts.find((p) => p.role === 'envPrompt');
  if (env && typeof env.content !== 'string') fail(`提示词 ${env.key} 的 content 不是字符串`);
  pass(`describe：${tools.length} 个工具、${events.length} 个事件、${prompts.length} 份提示词`);

  // 与代码一致：直接调 buildDescribe() 在进程内比对。
  // 不用 spawn 子进程 —— 受限沙箱里会 EPERM，而且 spawn 失败会被误读成「不一致」。
  const { buildDescribe, serialize } = await import(pathToFileURL(join(ROOT, 'tools', 'make-describe.mjs')).href);
  const live = await buildDescribe();
  if (live.missing.length) {
    fail(`tools() 返回了 describe 里没声明的工具：${live.missing.join(', ')}`);
  } else if (serialize(live.file).trim() !== read(c.describe).trim()) {
    fail('describe.json 与代码里的声明不一致：重跑 node tools/make-describe.mjs');
  } else {
    pass('describe.json 与代码里的声明一致');
  }
  if (live.drifted.length) {
    warn(`这些工具在默认配置下的描述或参数与声明不同（市场展示的是声明那份）：${live.drifted.join(', ')}`);
  }

  // 能力摘要
  const toolTokens = tools.reduce((sum, t) => sum
    + estimateTokens(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters })), 0);
  const envTokens = env ? estimateTokens(env.content) : 0;
  const tTier = tier(tools.length, 10, 20);
  const tokTier = tier(toolTokens, 2500, 6000);
  const envTier = tier(envTokens, 1000, 2500);
  pass(`摘要：${tools.length} 个工具、${events.length} 个事件、工具定义约 ${toolTokens} token、环境提示词约 ${envTokens} token`);
  if (tTier !== 'green' || tokTier !== 'green' || envTier !== 'green') {
    warn(`卡片上这几项会被标色：工具数 ${tTier}、工具 token ${tokTier}、前缀 ${envTier}（绿=不标，黄/红=提示）`);
  } else {
    pass('能力摘要三项都在绿色档，卡片上不会被标色');
  }
}

// ---------------------------------------------------------------------------
// 4. 图标与截图
// ---------------------------------------------------------------------------
const ICON_KINDS = { '.png': 512 * 1024, '.webp': 512 * 1024, '.svg': 512 * 1024 };
if (!c.icon) {
  warn('cortico.icon 没写：市场卡片会用默认占位图');
} else {
  const ext = c.icon.slice(c.icon.lastIndexOf('.')).toLowerCase();
  if (!(ext in ICON_KINDS)) fail(`cortico.icon 只认 .png / .webp / .svg，实际 ${ext}`);
  else if (!existsSync(join(ROOT, c.icon))) fail(`图标 ${c.icon} 不存在`);
  else if (!c.icon.startsWith('assets/')) warn(`图标在 ${c.icon}，惯例是放 assets/ 下`);
  else if (kb(c.icon) > ICON_KINDS[ext] / 1024) fail(`图标 ${kb(c.icon).toFixed(0)}KB 超过 512KB 上限`);
  else pass(`图标 ${c.icon}（${kb(c.icon).toFixed(1)}KB，上限 512KB）`);
}

if (Array.isArray(c.screenshots)) {
  if (c.screenshots.length > 8) fail(`screenshots 最多 8 张，现在 ${c.screenshots.length} 张`);
  for (const s of c.screenshots) {
    if (!existsSync(join(ROOT, s))) fail(`截图 ${s} 不存在`);
    else if (kb(s) > 2048) fail(`截图 ${s} ${kb(s).toFixed(0)}KB 超过 2MB 上限`);
  }
  if (c.screenshots.length) pass(`截图 ${c.screenshots.length} 张`);
} else {
  warn('没写 cortico.screenshots：详情页只有图标和文字。面板的图要自己截，脚本替不了');
}

// ---------------------------------------------------------------------------
// 5. CHANGELOG：Action 按二级标题里的第一个版本号切段
// ---------------------------------------------------------------------------
if (!existsSync(join(ROOT, 'CHANGELOG.md'))) {
  warn('没有 CHANGELOG.md：详情里的「历史版本」不会显示更新说明');
} else {
  const md = read('CHANGELOG.md');
  const heads = [...md.matchAll(/^##+\s+\[?v?(\d+\.\d+\.\d+[^\s\]]*)/gm)].map((m) => m[1]);
  if (!heads.includes(pkg.version)) {
    warn(`CHANGELOG.md 没有 ${pkg.version} 的二级标题：这一版在市场上不会显示更新说明`);
  } else pass(`CHANGELOG.md 有 ${pkg.version} 一节（共 ${heads.length} 个版本）`);
  if (md.length > 4000) warn('CHANGELOG 每段会被截到 2000 字，当前版本那节写太长会显示不全');
}

// ---------------------------------------------------------------------------
// 6. 发布清单：按 package.json 的 files 自己走一遍
//    不 spawn `npm pack`（受限沙箱里 EPERM，而且它慢）；files 字段就是打包的根规则，
//    再加上 package.json / README / CHANGELOG / LICENSE 这几个 npm 强制或惯例带的文件。
// ---------------------------------------------------------------------------
const walk = (dir, out = []) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.tmp')) continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else out.push({ path: rel, size: st.size });
  }
  return out;
};

{
  const always = ['package.json', 'README.md', 'CHANGELOG.md'];
  const roots = Array.isArray(pkg.files) ? pkg.files : [];
  const listed = [];
  for (const root of roots) {
    if (!existsSync(join(ROOT, root))) {
      fail(`package.json 的 files 里写了 ${root}，但磁盘上没有`);
      continue;
    }
    const st = statSync(join(ROOT, root));
    if (st.isDirectory()) listed.push(...walk(root));
    else listed.push({ path: root, size: st.size });
  }
  for (const f of always) {
    if (existsSync(join(ROOT, f)) && !listed.some((x) => x.path === f)) {
      listed.push({ path: f, size: statSync(join(ROOT, f)).size });
    }
  }

  const paths = listed.map((f) => f.path);
  const total = listed.reduce((s, f) => s + f.size, 0);

  const need = ['package.json', 'src/index.js', 'src/ENV_PROMPT.md', 'dist/webui.js', 'describe.json', 'assets/icon.png', 'README.md'];
  const missing = need.filter((p) => !paths.includes(p));
  if (missing.length) fail(`发布清单里缺这些文件：${missing.join(', ')}`);
  else pass(`发布清单 ${paths.length} 个文件、${(total / 1024).toFixed(0)}KB`);

  const dataFiles = paths.filter((f) => /^src\/data\/.+\.json$/.test(f));
  if (dataFiles.length !== 20) fail(`菜品数据只带 ${dataFiles.length} 个，应为 20 个`);
  else pass(`菜品数据 ${dataFiles.length} 个文件全在清单里`);

  const leaked = paths.filter((f) => /^(test|tools)\//.test(f) || /\.bak-/.test(f) || f === 'install.ps1' || f.startsWith('.tmp'));
  if (leaked.length) fail(`这些不该发布：${leaked.join(', ')}`);
  else pass('test / tools / install.ps1 / 备份文件都不在发布清单里');

  if (total > 2 * 1024 * 1024) warn(`解包 ${(total / 1024 / 1024).toFixed(1)}MB，偏大；npm 包上限 100MB 但下载会慢`);
}

// ---------------------------------------------------------------------------
// 7. 联机：包名是否可用
//    直接问 registry，不 spawn `npm view` —— 受限沙箱里 spawn 会 EINVAL/EPERM。
// ---------------------------------------------------------------------------
if (ONLINE) {
  const registry = (process.env.npm_config_registry ?? 'https://registry.npmjs.org/').replace(/\/+$/, '');
  const url = `${registry}/${encodeURIComponent(pkg.name).replace(/^%40/, '@')}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) {
      pass(`${pkg.name} 在 ${new URL(registry).host} 上没被占，可以发`);
    } else if (res.ok) {
      const doc = await res.json();
      const versions = Object.keys(doc.versions ?? {});
      const latest = doc['dist-tags']?.latest ?? versions.at(-1) ?? '?';
      if (versions.includes(pkg.version)) {
        fail(`${pkg.name}@${pkg.version} 已经发过了：npm 不允许覆盖同名同版本，改版本号或升版本`);
      } else if (latest === pkg.version) {
        fail(`${pkg.name} 最新就是 ${pkg.version}，换个更高的版本号再发`);
      } else {
        pass(`${pkg.name} 已存在（最新 ${latest}）；你这次的 ${pkg.version} 是新的，可以发`);
      }
    } else {
      warn(`registry 回了 ${res.status}，查不了包名占用`);
    }
  } catch (err) {
    warn(`查不了包名占用（网络）：${err?.message ?? err}`);
  }
} else {
  warn('没查 npm 上的包名占用（加 --online 查）');
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
for (const m of ok) console.log(`  ✓ ${m}`);
for (const m of warnings) console.log(`  ⚠ ${m}`);
for (const m of failures) console.log(`  ✗ ${m}`);
console.log(`\n${ok.length} 项通过，${warnings.length} 条警告，${failures.length} 处失败`);
if (failures.length) {
  console.log('\n失败项不发版就过不去。警告项可以照发，但市场卡片或详情上看得出来。');
  process.exitCode = 1;
}