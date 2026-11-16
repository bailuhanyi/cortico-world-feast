/**
 * 「能做的事」：主人按日型给她备的一份**具体能做**的清单。
 *
 * 它只做一件事：进「请她写明天」那条事件的正文。这样她写日程时手边有一张
 * 「这天真能做什么」的单子，写出来的每一段就是真能做的一件事，而不是
 * 「在家玩」「自己的时间」这种读起来像空白的东西。留空 = 不生效，跟以前一样让她自己编。
 *
 * 格式（容错：写歪了只是少几行，不报错、不把 World 拖挂）：
 *
 *   上班日：
 *   - 在公司写方案，被叫去开会
 *   - 午休找主人聊两句（qq 发消息）
 *   休息日：
 *   - 追番（bvp_watch_now mode="text"）
 *   - 下楼买菜，顺手发条空间动态（qq_qzone action=post）
 *
 * 规则：
 *   · 一行只写「日型名：」就开一节；日型名认名字（上班日）也认 id（workday），
 *     大小写、空格都不计。写不出来的节直接跳过，不影响别的节。
 *   · 以 - * • · 或「1.」开头的行是一件；不写符号的普通行也算一件（省得为格式吵架）。
 *   · 第一节之前、没写日型的那些行 = **所有日型通用**的兜底清单。
 *   · 同一天型有自己的一节就只用那一节，没有才用通用清单。
 *
 * 关于工具：**只写你真装了的工具**，而且要把工具名和调用写法写清（跟 lifeFreeMenu 一个规矩）。
 * 这里不做自动检测：只认识「娱乐时间」「鱼的小世界」那两个联动（它们有 worlds.*.enabled 可读），
 * 别的扩展没法从配置里判断装没装。写了一个她那里没有的工具，她会照着做但做不成。
 *
 * 为什么叫「能做的事」而不是「任务」：这份东西只进那一条邀请，措辞上写明
 * 「从这里挑也行、自己另想也行、一件都不写也行」；它不是待办，也不进系统前缀。
 */

const MAX_ITEM = 120;
const MAX_ITEMS = 20;
const MAX_SECTIONS = 12;

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normKey = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase().slice(0, 20);

/**
 * @returns {{ any: string[], byType: Map<string, string[]> }}
 *   `any` 是通用兜底；`byType` 以「名字或 id 压平后的小写」为键。
 */
export function parseDoings(raw) {
  const out = { any: [], byType: new Map() };
  let cur = out.any;
  for (const rawLine of String(raw ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // 「上班日：」这种整行只有一个标题的，开一节。带内容的行（「- 发消息：告诉主人」）不算。
    const sec = /^(.{1,20}?)\s*[:：]\s*$/.exec(line);
    if (sec) {
      const key = normKey(sec[1]);
      if (!key || out.byType.size >= MAX_SECTIONS) {
        cur = null;
        continue;
      }
      if (!out.byType.has(key)) out.byType.set(key, []);
      cur = out.byType.get(key);
      continue;
    }
    if (!cur) continue;
    const item = str(line.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, ''), MAX_ITEM);
    if (!item) continue;
    if (cur.length >= MAX_ITEMS || cur.includes(item)) continue;
    cur.push(item);
  }
  return out;
}

/** 这一天的日型能用的清单：有专属就用专属，没有就用通用的。 */
export function doingsFor(all, type) {
  if (!all || !type) return [];
  for (const k of [normKey(type.id), normKey(type.name)]) {
    const hit = k ? all.byType.get(k) : null;
    if (hit?.length) return hit;
  }
  return all.any;
}

/** 这块文本进「请她写明天」的事件正文；没有清单时返回空数组。 */
export function doingsLines(doings = []) {
  if (!doings.length) return [];
  return [
    '你手边真能做的事（主人给你备的，不是任务；写日程时从里面挑也行，写清单外的也行，只要是真能做的一件事）：',
    ...doings.map((d) => `- ${d}`),
    '（挑一两件具体的事写进日程就够了；一件都不挑、自己另想，也完全可以。）',
  ];
}
