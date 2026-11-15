/**
 * 「她自己的时间」↔ 娱乐时间（`cortico-world-fun`）的那一行例子。
 *
 * 为什么单独一个模块：
 *   · 它只做两件事——**读 Coo config 判断娱乐时间装没装**、**拼一行给她的例子**；
 *   · 两件事都是纯函数 + 一次读文件，不该塞进 world.js 里再长三百行；
 *   · 测试要能单独钉住「没装就不出现」「装了就出现」「手改过就不重复」。
 *
 * 这是官方预留给用户的 `lifeFreeMenu` 那条路的**自动化版本**：0.7.4 之前用户得
 * 自己把 `fun_places → fun_go → …` 抄进配置里，还容易和默认那四条例子叠成两套。
 * 现在一个开关 + 自动检测就够了。
 *
 * 红线（和 wardrobe.js 读 imggen 的 libraryRoot 同一套）：
 *   · **只读 config.json 一个字段**（`worlds.fun.enabled`），不调娱乐时间的工具、
 *     不读它的 `dataDir/fun/state.json` —— 读配置文件不算 World 间依赖；
 *   · 读不到 / 解析失败 / 没装 → 返回「没装」，那一行**整段不出现**，
 *     绝不让她看到指向不存在工具的例子；
 *   · 任何异常都吞掉，**绝不抛错**（抛错会把整个 World 卸载）。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 要拼进「例子」的那一行。
 *
 * 写法照 feast 配置描述里的官方建议（「想让她真用上某个工具，在这里写明」）：
 * 一行里把四个动作串成一句，别写成四条——`lifeFreeMenu` 是「例子」，不是待办清单。
 *
 * **刻意不点名具体场所**：娱乐时间的场所库以后还会加（0.1.0 已从 4 处扩到 12 处），
 * 写死「游乐场 / 海洋馆 / 庙会 / 漫展」的话，每加一处都得回来改这行。
 * 让 `fun_places` 自己去列，这一行就长期有效。
 */
export const FUN_LINE = '- 出门去逛逛：fun_places 看今天能去哪 → fun_go 进门 → fun_wander 逛一处 → fun_home 收摊';

/**
 * 判断这一行是不是「已经在菜单里了」。
 *
 * 不按整行比：用户可能手改过（比如把「游乐场」补进去、或者把箭头改成「→」以外的写法），
 * 那时整行匹配不上，会再追加一条，菜单里就出现两条几乎一样的。
 * 判据取「提到 fun_go」——那一行只要指向娱乐时间就够了，怎么措辞是用户的自由。
 */
const HAS_FUN_RE = /fun_[a-z]+/;

/**
 * 读娱乐时间的安装/启用状态。
 *
 * 宿主的 config 路径按 `dataDir` 的父目录找（`<dataDir>/../config.json`），
 * 和 `wardrobe.js` 的 `readImggenRoot` 一致——数据目录是 `…/home/companion`，
 * config.json 在它的上一层。
 *
 * `config.json` 是 Coo **整份重写**的（改任何配置项都会重写一次），存在「读到写了
 * 一半的文件」的窗口。解析失败时**等 200ms 重试一次**，再失败才判成「没装」——
 * 否则用户改配置的那一瞬间正好触发叫醒，会误判成「没装娱乐时间」而漏掉那一行。
 *
 * @returns {Promise<boolean>} 装并且启用了才 true；其余一律 false（静默降级）。
 */
export async function readFunEnabled(dataDir) {
  const tryOnce = async () => {
    try {
      const raw = JSON.parse(await readFile(join(dataDir, '..', 'config.json'), 'utf8'));
      // 只认 `enabled`：那是宿主的 World 总开关，用户关掉世界页就是它在变。
      return raw?.worlds?.fun?.enabled === true;
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
 *   1. `lifeFreeFunOn` 没被关掉（默认开）；
 *   2. 娱乐时间装了并且启用着（`worlds.fun.enabled === true`）；
 *   3. **现有菜单里还没有指向 fun_* 的一行**——用户自己抄过的话就别再叠一条。
 *
 * @param {string} menu 现有菜单（`cfg.lifeFreeMenu` 或 DEFAULTS）
 * @param {boolean} funOn 娱乐时间是否装了并启用
 * @param {object} cfg 配置段（判 lifeFreeFunOn）
 * @returns {string} 要追加的一行；不该加就是空串
 */
export function funMenuLine(menu, funOn, cfg = {}) {
  if (cfg?.lifeFreeFunOn === false) return '';
  if (!funOn) return '';
  if (HAS_FUN_RE.test(typeof menu === 'string' ? menu : '')) return '';
  return FUN_LINE;
}

/**
 * 把那一行接到菜单末尾（没有要加的就不动原样）。
 *
 * 只追加，不改写、不排序、不动用户原有的任何一条——那是用户自己写的话。
 */
export function withFunLine(menu, funOn, cfg = {}) {
  const base = typeof menu === 'string' ? menu : '';
  const line = funMenuLine(base, funOn, cfg);
  if (!line) return base;
  const head = base.replace(/\s+$/, '');
  // 空菜单时别拼出以换行开头的东西。
  return head ? `${head}\n${line}` : line;
}
