/**
 * 「她自己的时间」↔ 小地图（`cortico-world-map`）的那一行例子。
 *
 * 和 `funlink.js` **同构**——这是刻意的：同一件事（读一个 config 字段判断装没装、
 * 拼一行例子、只追加不改写）有两份实现，就一定会有一份先腐烂。差别只有三处：
 * world id（`map`）、那一行的文案（`MAP_LINE`）、去重前缀（`map_`）。
 *
 * 契约出处：`MAP-小地图插件-方案.md` §7「给鱼的每一天那个会话的契约」。
 *
 * 红线（和 `funlink.js` / `wardrobe.js` 读 imggen 的 libraryRoot 同一套）：
 *   · **只读 config.json 一个字段**（`worlds.map.enabled`），不调小地图的工具、
 *     不读它的 `dataDir/map/state.json` —— 读配置文件不算 World 间依赖；
 *   · 读不到 / 解析失败 / 没装 → 返回「没装」，那一行**整段不出现**，
 *     绝不让她看到指向不存在工具的例子；
 *   · 任何异常都吞掉，**绝不抛错**（抛错会把整个 World 卸载）。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 要拼进「例子」的那一行。
 *
 * **刻意不点名具体地点**：小地图的地点库是**每个主人自己的**（有人家在小区、
 * 有人家在森林里），写死任何一个地名都是替别人编。让 `map_places` 自己去列。
 *
 * 也刻意不写「画一张」「发张图」这类话：小地图**不强绑生图工作室**（方案 §4），
 * 没装生图的主人照样用，这一行不能暗示她有出图能力。
 */
export const MAP_LINE = '- 看看周围、去个常去的地方：map_places 看有哪些地方 → map_look 看这一处长什么样';

/**
 * 判断这一行是不是「已经在菜单里了」。
 *
 * 和 `HAS_FUN_RE` 同样取「提到 map_ 开头的工具」，不按整行比——用户可能手改过
 * 措辞、或者只抄了 `map_places` 那一半，整行匹配不上会再追加一条，菜单里就出现
 * 两条几乎一样的。
 *
 * 注意前缀是 `map_` 不是 `fun_`：两行并存时各判各的，`fun_[a-z]+` 不会命中
 * `MAP_LINE`，`map_[a-z]+` 也不会命中 `FUN_LINE`，所以谁先谁后都不会互相误伤。
 */
const HAS_MAP_RE = /map_[a-z]+/;

/**
 * 读小地图的安装/启用状态。
 *
 * 宿主的 config 路径按 `dataDir` 的父目录找（`<dataDir>/../config.json`），
 * 和 `readFunEnabled` / `wardrobe.js` 的 `readImggenRoot` 完全一致。
 *
 * `config.json` 是 Coo **整份重写**的（改任何配置项都会重写一次），存在「读到写了
 * 一半的文件」的窗口。解析失败时**等 200ms 重试一次**，再失败才判成「没装」——
 * 否则用户改配置的那一瞬间正好触发叫醒，会误判成「没装小地图」而漏掉那一行。
 *
 * @returns {Promise<boolean>} 装并且启用了才 true；其余一律 false（静默降级）。
 */
export async function readMapEnabled(dataDir) {
  const tryOnce = async () => {
    try {
      const raw = JSON.parse(await readFile(join(dataDir, '..', 'config.json'), 'utf8'));
      // 只认 `enabled`：那是宿主的 World 总开关，用户关掉世界页就是它在变。
      return raw?.worlds?.map?.enabled === true;
    } catch {
      return null; // 区分「读不到/解析失败」(null) 和「读到了但没这个段」(false)
    }
  };
  const first = await tryOnce();
  if (first !== null) return first;
  await new Promise((r) => setTimeout(r, 200));
  const second = await tryOnce();
  return second === true;
}

/**
 * 该不该把那一行加进「例子」里。
 *
 * 三个条件都满足才加：
 *   1. `lifeFreeMapOn` 没被关掉（默认开）；
 *   2. 小地图装了并且启用着（`worlds.map.enabled === true`）；
 *   3. **现有菜单里还没有指向 map_* 的一行**——用户自己抄过的话就别再叠一条。
 *
 * @param {string} menu 现有菜单（`cfg.lifeFreeMenu`、DEFAULTS，或已经被 funlink 拼过的菜单）
 * @param {boolean} mapOn 小地图是否装了并启用
 * @param {object} cfg 配置段（判 lifeFreeMapOn）
 * @returns {string} 要追加的一行；不该加就是空串
 */
export function mapMenuLine(menu, mapOn, cfg = {}) {
  if (cfg?.lifeFreeMapOn === false) return '';
  if (!mapOn) return '';
  if (HAS_MAP_RE.test(typeof menu === 'string' ? menu : '')) return '';
  return MAP_LINE;
}

/**
 * 把那一行接到菜单末尾（没有要加的就不动原样）。
 *
 * 只追加，不改写、不排序、不动用户原有的任何一条——那是用户自己写的话。
 * 接在 `withFunLine` 之后调用即可与「出门去逛逛」那一行并存，顺序固定为
 * 娱乐时间在前、小地图在后。
 */
export function withMapLine(menu, mapOn, cfg = {}) {
  const base = typeof menu === 'string' ? menu : '';
  const line = mapMenuLine(base, mapOn, cfg);
  if (!line) return base;
  const head = base.replace(/\s+$/, '');
  // 空菜单时别拼出以换行开头的东西。
  return head ? `${head}\n${line}` : line;
}
