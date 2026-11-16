/**
 * 日程里这一段，对她来说算什么：睡觉 / 被占用 / 空着 / 没有日程。
 *
 * **全扩展唯一一处判据。** 0.7.x 之前同一件事写了三份（free.js 的两张正则、
 * world.js 里三个各自取一次段的私有方法），三处各自成立、谁也不知道谁，
 * 于是「21:00 那一档算不算她的时间」在不同路径上可能得出不同答案。
 *
 * 为什么是排除法（0.7.2 的教训，照抄在这里，别再改回白名单）：
 * 白名单（自己的时间/自由/在家玩/休息/摸鱼/追剧…）在真实日程上 13 段只命中 2 段，
 * 默认三档里两档被静默跳过，面板上只剩「今天没有了 / 已记 0 件」，功能像坏的。
 * 判反了会互相打脸（上班时说「这是你的时间」），但把「她分明闲着」漏掉一样是错。
 * 折中：**只排除明确被占用的**，其余都算她的空档。刷手机、打游戏、窗边发呆、
 * 收拾屋子、追剧——这些都是她自己的时间。
 *
 * 睡觉词是占用词的子集（下面两张表就是按这个写的），所以先判睡、再判忙，
 * 顺序不能反：「午睡」既该算 asleep，也不该被当成 busy 去报备。
 */

/** 睡觉（0.7.2 补：以前各处都写 /睡/，「回笼觉」「打盹」「补觉」都不算睡）。 */
const SLEEP_HINTS = /睡|回笼觉|打盹|小憩|眯一会儿|眯一会|补觉|午觉|赖床/;

/** 明确被占用：这些时候不该被当成「她自己的时间」。 */
const BUSY_HINTS = /睡|回笼觉|打盹|小憩|眯一会儿|眯一会|补觉|午觉|赖床|上班|通勤|开会|加班|赶工|赶稿|赶进度|工作|办公|搬砖|值班|出差|面试|上课|考试|会议|训练|排练/i;

/** 兼容：老调用点传对象（item）也传过字符串（activity 名）。 */
const activityOf = (item) => String((typeof item === 'string' ? item : item?.activity) ?? '')
  .replace(/\s+/g, ' ').trim();

/**
 * @returns {'asleep'|'busy'|'free'|'none'}
 *   none = 没有这一段 / 活动名是空的（还没写日程）。调用方自己决定怎么兜底。
 */
export function classifyItem(item) {
  const act = activityOf(item);
  if (!act) return 'none';
  if (SLEEP_HINTS.test(act)) return 'asleep';
  if (BUSY_HINTS.test(act)) return 'busy';
  return 'free';
}

/** 睡着了吗（「她自己的时间」和时段事件都用这个，别各写一份 /睡/）。 */
export const isAsleep = (item) => classifyItem(item) === 'asleep';

/** 这一段算她自己的时间吗（只有明确空着才算，none 不算）。 */
export const isFree = (item) => classifyItem(item) === 'free';
