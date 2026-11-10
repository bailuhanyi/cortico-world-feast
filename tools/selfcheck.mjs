/**
 * selfcheck.mjs —— 复刻 Coo `check:extension` 对 world 类扩展的干装载检查。
 *
 * 为什么自己写一份：Coo 的检查在它的源码树里跑（`pnpm check:extension`），
 * 而这个仓库是独立扩展包；装完再发现问题太晚了。这里按 dry-mount.ts 的判据逐条过一遍，
 * 判据取自 build/cortico/src/extensions/dry-mount.ts。
 *
 * 用法：node tools/selfcheck.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL_ID = /^[a-z0-9-]+$/;
const TOOL_PREFIX = /^[a-z0-9]+_/;
const MODULE_LAMP_MAX = 7;

const ok = [];
const warnings = [];
const failures = [];

function getByPath(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// ---- manifest ----
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const c = pkg.cortico ?? {};
if (c.kind !== 'world') failures.push(`cortico.kind 应为 world，实际 ${JSON.stringify(c.kind)}`);
if (c.api !== 6) failures.push(`cortico.api 应为 6，实际 ${JSON.stringify(c.api)}`);
if (pkg.type !== 'module') failures.push(`package.type 应为 module，实际 ${JSON.stringify(pkg.type)}`);
for (const f of [c.webUiClient, c.describe]) {
  if (!f) continue;
  if (!existsSync(join(ROOT, f))) failures.push(`cortico 指向的 ${f} 不存在`);
}
if (!c.webUiClient) warnings.push('manifest 没有 cortico.webUiClient：面板会被跳过');
ok.push(`manifest: kind=world api=6 type=module webUiClient=${c.webUiClient} describe=${c.describe}`);

// ---- 定义 ----
const def = (await import(pathToFileURL(join(ROOT, 'src', 'index.js')).href)).default;

let defaults;
try {
  defaults = def.defaults();
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    failures.push('defaults() 没返回对象');
  } else if (defaults.enabled !== false) {
    warnings.push('defaults().enabled 不是 false：启用与否由部署和 declares 决定');
  } else {
    ok.push(`defaults(): ${Object.keys(defaults).length} 个键，enabled=false`);
  }
} catch (err) {
  failures.push(`defaults() 抛错：${err.message}`);
}

// create() 必须在默认配置、无密钥下就成功——装配层会构造每一个可用定义。
const dataDir = join(ROOT, '.tmp', 'selfcheck');
const ctx = {
  id: def.id,
  cfg: defaults,
  timezone: 'Asia/Shanghai',
  botName: 'Coo',
  botDir: ROOT,
  packageDir: ROOT,
  dataDir,
  repoRoot: ROOT,
  secret: () => '',
  storeSecret: () => {},
  persist: () => {},
  restart: async () => {},
};

let world;
try {
  world = def.create(ctx);
  if (world.id !== def.id) failures.push(`实例 id「${world.id}」与定义 id「${def.id}」不一致`);
  else ok.push(`create(): 实例 id = ${world.id}`);
} catch (err) {
  failures.push(`create() 在默认配置下抛错：${err.message}`);
}

// ---- 工具 ----
if (world) {
  let tools;
  try {
    tools = world.tools();
    if (!Array.isArray(tools)) failures.push('tools() 没返回数组');
  } catch (err) {
    failures.push(`tools() 抛错：${err.message}`);
  }
  if (Array.isArray(tools)) {
    const seen = new Set();
    for (const t of tools) {
      const name = t?.name;
      if (!name) { failures.push('有工具没有 name'); continue; }
      if (seen.has(name)) failures.push(`工具名重复：${name}`);
      seen.add(name);
      if (t.parameters === null || typeof t.parameters !== 'object' || Array.isArray(t.parameters)) {
        failures.push(`工具 ${name} 的 parameters 不是对象`);
      }
      if (typeof t.handler !== 'function') failures.push(`工具 ${name} 没有 handler`);
      if (!Array.isArray(t.tags)) failures.push(`工具 ${name} 没有 tags 数组`);
      else if (t.tags.length === 0) warnings.push(`工具 ${name} 的 tags 是空的，按 tag 选工具时永远选不中`);
      if (!TOOL_PREFIX.test(name)) warnings.push(`工具名 ${name} 没有 <短名>_ 前缀`);
    }
    ok.push(`tools(): ${tools.length} 个，名字唯一、都有 parameters/handler/tags`);
  }

  // envPromptVars 必须是对象或 null
  try {
    const vars = world.envPromptVars();
    if (vars !== null && (typeof vars !== 'object' || Array.isArray(vars))) {
      failures.push('envPromptVars() 必须返回对象或 null');
    } else {
      ok.push(`envPromptVars(): ${vars === null ? 'null' : `${Object.keys(vars).length} 个键`}（只放一天一变的低频变量，避免打穿前缀缓存）`);
    }
  } catch (err) {
    failures.push(`envPromptVars() 抛错：${err.message}`);
  }

  // ---- webUi ----
  let decl;
  try {
    decl = world.webUi('zh');
  } catch (err) {
    failures.push(`webUi() 抛错：${err.message}`);
  }
  if (decl) {
    const panels = decl.panels ?? [];
    const ids = new Set();
    for (const p of panels) {
      if (!PANEL_ID.test(p.id)) failures.push(`面板 id「${p.id}」形状不对（只能 [a-z0-9-]）`);
      if (ids.has(p.id)) failures.push(`面板 id 重复：${p.id}`);
      ids.add(p.id);
      if (!p.title) warnings.push(`面板 ${p.id} 没有 title`);
    }
    if (panels.length && !c.webUiClient) {
      warnings.push(`webUi() 声明了 ${panels.length} 个面板，但 manifest 没有 webUiClient`);
    }
    ok.push(`webUi(): 面板 ${panels.length} 个（${[...ids].join(', ')}）、配置组 ${decl.config?.length ?? 0} 个、提示词模板 ${decl.promptDocs?.length ?? 0} 份、存储 ${decl.storage?.length ?? 0} 项`);

    if ((decl.lamps?.length ?? 0) > MODULE_LAMP_MAX) warnings.push(`lamps 有 ${decl.lamps.length} 个，导航最多画 ${MODULE_LAMP_MAX} 个`);
    for (const l of decl.lamps ?? []) {
      if (!['online', 'loading', 'error', 'offline'].includes(l.state)) failures.push(`状态灯「${l.label}」的 state 不合法：${l.state}`);
    }

    for (const group of decl.config ?? []) {
      if (group.owner !== `world:${def.id}`) warnings.push(`配置组 ${group.id} 的 owner 是 ${group.owner}，应为 world:${def.id}`);
      for (const path of Object.keys(group.schema?.properties ?? {})) {
        if (!path.startsWith(`worlds.${def.id}.`)) {
          failures.push(`配置路径「${path}」不在 worlds.${def.id}. 段内`);
          continue;
        }
        if (getByPath(defaults, path.slice(`worlds.${def.id}.`.length)) === undefined) {
          failures.push(`配置路径「${path}」在 defaults() 里没有对应项：面板能改、也能写进 config.json，但代码读的还是兜底值`);
        }
      }
    }
    ok.push(`config 路径全部落在 worlds.${def.id}. 段内，且都在 defaults() 里有默认值`);

    for (const doc of decl.promptDocs ?? []) {
      if (!doc.path || !existsSync(doc.path)) warnings.push(`提示词模板 ${doc.path} 不存在，这一节会是空的`);
      if (doc.role === 'envPrompt') ok.push(`envPrompt 模板：${relative(ROOT, doc.path)}（${readFileSync(doc.path, 'utf8').length} 字符）`);
    }

    for (const part of decl.storage ?? []) {
      if (typeof part.stat !== 'function' || typeof part.clear !== 'function') failures.push(`存储项 ${part.key} 缺 stat/clear`);
      else ok.push(`存储项 ${part.key}：${part.stat()}`);
    }
  }

  // ---- 自描述 ----
  const describeFile = c.describe ? join(ROOT, c.describe) : null;
  if (!describeFile || !existsSync(describeFile)) {
    failures.push('manifest 没有 cortico.describe 或文件不存在：市场只读这个文件');
  } else {
    const written = JSON.parse(readFileSync(describeFile, 'utf8'));
    const declared = new Set((written.tools ?? []).map((t) => t.name));
    const live = world.tools().map((t) => t.name);
    const extra = live.filter((n) => !declared.has(n));
    if (extra.length) failures.push(`tools() 返回了没在 describe.json 里声明的工具：${extra.join(', ')}`);
    else ok.push(`describe.json：${declared.size} 个工具都在声明里，${(written.events ?? []).length} 个事件`);
    if (!written.prompts?.length) warnings.push('describe.json 没有 prompts：市场看不到环境提示词');
  }
}

// ---- 报告 ----
for (const l of ok) console.log(`  ✓ ${l}`);
for (const l of warnings) console.log(`  ⚠ ${l}`);
for (const l of failures) console.log(`  ✗ ${l}`);
console.log(`\n${ok.length} 项通过，${warnings.length} 条警告，${failures.length} 处失败`);
if (failures.length) process.exitCode = 1;