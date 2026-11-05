/**
 * 生成 describe.json —— 扩展市场只读这个文件，不执行扩展代码。
 *
 * 产物必须与 Coo 的 `pnpm describe:extension` 逐字节一致：它用 dry-mount 的假上下文
 * 构造一次 Definition，取 `tools()` 的 name/description/parameters，加上定义里的
 * describe.tools / describe.events，并把 role=envPrompt 的模板原文塞进 prompts。
 *
 * 这里把「怎么算」抽成 buildDescribe()，好让 publish-check 在进程内直接比对，
 * 不必 spawn 一个子进程（受限沙箱里 spawn 会被 EPERM 挡住）。
 *
 * 用法：node tools/make-describe.mjs [--check]
 *   --check  只比对，不一致时退出码 1（CI 用）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_DIR = ROOT;
export const DESCRIBE_PATH = join(ROOT, 'describe.json');

/**
 * 按 Coo 的 exportDescribe 口径算出 describe.json 的内容。
 * 返回 { file, tools, prompts, live, missing, drifted }：前三个是要写出去的东西，
 * 后三个是自检结果（同名工具是否都声明了、默认配置下的描述参数有没有漂）。
 */
export async function buildDescribe() {
  const def = (await import(pathToFileURL(join(ROOT, 'src', 'index.js')).href)).default;

  /** 与 dry-mount 的 fakeWorldContext 同形：只要够构造 World，不碰磁盘。 */
  const defaults = def.defaults();
  const fakeCtx = {
    id: def.id,
    cfg: defaults,
    timezone: 'Asia/Shanghai',
    botName: 'Coo',
    botDir: ROOT,
    packageDir: ROOT,
    dataDir: join(ROOT, '.tmp'),
    repoRoot: ROOT,
    secret: () => '',
    storeSecret: () => {},
    persist: (patch) => Object.assign(defaults, patch),
    restart: async () => {},
  };

  const world = def.create(fakeCtx);
  const docs = (world.webUi?.('zh')?.promptDocs ?? []).filter((doc) => doc.role === 'envPrompt');

  const prompts = [];
  for (const doc of docs) {
    if (!existsSync(doc.path)) continue;
    prompts.push({
      key: doc.key,
      title: doc.title,
      ...(doc.role ? { role: doc.role } : {}),
      content: readFileSync(doc.path, 'utf8'),
    });
  }

  // 声明里缺 summary 时市场用 description 的第一句；这里两者都写全了，照抄即可。
  const tools = def.describe.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    tags: [...t.tags],
    ...(t.summary ? { summary: t.summary } : {}),
  }));

  const file = {
    tools,
    events: def.describe.events.map((e) => ({
      type: e.type,
      description: e.description,
      ...(e.trigger ? { trigger: e.trigger } : {}),
      ...(e.tags ? { tags: [...e.tags] } : {}),
    })),
    ...(prompts.length ? { prompts } : {}),
  };

  // 与 Coo 的检查同口径：实例给的工具名不许漏在声明外；默认配置下描述与参数也要一致。
  const declared = new Map(tools.map((t) => [t.name, t]));
  const live = world.tools().map(({ name, description, parameters }) => ({ name, description, parameters }));
  const missing = live.filter((t) => !declared.has(t.name)).map((t) => t.name);
  const drifted = live
    .filter((t) => {
      const d = declared.get(t.name);
      return d && (d.description !== t.description || JSON.stringify(d.parameters) !== JSON.stringify(t.parameters));
    })
    .map((t) => t.name);

  return { file, tools, prompts, live, missing, drifted };
}

/** 序列化成写盘用的文本（结尾换行，缩进 2）。 */
export const serialize = (file) => `${JSON.stringify(file, null, 2)}\n`;

const run = isMain();
if (run) {
  const { file, tools, prompts, missing, drifted } = await buildDescribe();
  if (missing.length) {
    console.error(`✗ tools() 返回了没声明的工具：${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    if (drifted.length) {
      console.warn(`⚠ 这些工具在默认配置下的描述/参数与声明不一致：${drifted.join(', ')}`);
    }
    const json = serialize(file);
    if (process.argv.includes('--check')) {
      const current = existsSync(DESCRIBE_PATH) ? readFileSync(DESCRIBE_PATH, 'utf8') : '';
      if (current.trim() !== json.trim()) {
        console.error(`✗ ${relative(ROOT, DESCRIBE_PATH)} 与代码里的自描述不一致，重跑 node tools/make-describe.mjs`);
        process.exitCode = 1;
      } else {
        console.log(`✓ ${relative(ROOT, DESCRIBE_PATH)} 与代码一致（${tools.length} 个工具、${file.events.length} 个事件）`);
      }
    } else {
      writeFileSync(DESCRIBE_PATH, json, 'utf8');
      console.log(`✓ 已写 ${relative(ROOT, DESCRIBE_PATH)}：${tools.length} 个工具、${file.events.length} 个事件、${prompts.length} 份提示词`);
    }
  }
}

/** 被 import 时不要跑 CLI 那一段。 */
function isMain() {
  const thisFile = fileURLToPath(import.meta.url);
  const entry = process.argv[1];
  if (!entry) return false;
  return thisFile.toLowerCase() === entry.replace(/\\/g, '/').toLowerCase()
    || thisFile.toLowerCase() === fileURLToPath(pathToFileURL(entry)).toLowerCase();
}