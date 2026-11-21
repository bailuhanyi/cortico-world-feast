/**
 * 可选 fun/map 联动只读取宿主配置中的 enabled，不读取其他 World 的状态。
 *
 * 宿主明确给出 botDir 时，botDir/config.json 是唯一权威来源；dataDir 可以自定义，
 * 不应再靠数据目录猜配置。旧宿主/直接创建实例未给 botDir 时兼容两种布局：
 * 先 dataDir/config.json，只有该文件确实缺失才看 ../config.json。
 *
 * 已存在的配置即使缺段、禁用、损坏或不可读，也不能被另一份旧配置翻成启用。
 * 非 ENOENT 的读取/解析失败等 200ms 后只重试同一文件一次；重试时文件消失仍降级
 * 为 false，不转读旧副本。正常缺文件不等待，不新增后台任务或缓存用户配置。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** readText / pause 只用于隔离 I/O 的测试，不是用户配置或能力发现接口。 */
export async function readLinkedWorldEnabled(dataDir, worldId, {
  botDir, readText = readFile, pause = wait,
} = {}) {
  try {
    if (worldId !== 'fun' && worldId !== 'map') return false;
    const explicit = typeof botDir === 'string' && botDir.trim() !== '';
    const paths = explicit
      ? [join(botDir, 'config.json')]
      : [...new Set([join(dataDir, 'config.json'), join(dataDir, '..', 'config.json')])];
    for (const path of paths) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const config = JSON.parse(await readText(path, 'utf8'));
          return config?.worlds?.[worldId]?.enabled === true;
        } catch (error) {
          if (attempt === 0 && error?.code === 'ENOENT') break;
          if (attempt === 0) { await pause(200); continue; }
          return false;
        }
      }
    }
  } catch { /* 路径无效或其他 I/O 异常也不能拖挂 World。 */ }
  return false;
}
