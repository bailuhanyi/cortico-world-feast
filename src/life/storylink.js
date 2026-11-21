/** Optional host-conversation guidance only. No foreign tool calls or business-file reads. */
import { withFunLine } from './funlink.js';
import { withMapLine } from './maplink.js';

export const STORY_MIN_VERSION = 'cortico-world-fun@0.3.2-story.2';
export function storyLinkOn(funOn, cfg = {}) {
  return funOn === true && cfg?.lifeStoryOn === true && cfg?.lifeFreeFunOn !== false;
}

// Kept in event bodies, never the persistent environment prompt. No catalog is loaded here.
const RECEIPT_HINT = '仅在宿主当前会话实际声明相应工具且允许查询时按需调用；开关、enabled 和包版本都不是能力证明。先检查外层 failed，再解析 text 中的 JSON；只有内层 ok===true 才是成功查询。failed:true、ok:false、缺失/畸形 text、权限不明、无候选或过期不可用都不推断成功；故事卡须 enabled===true 且 available===true 才作为当前可用。已知存档异常时，其他查询成功也不证明可出发。可重新读取，或改用普通生活邀请或既有可用路径。卡片缺版本、作者、条件、可用性或时长就说明未知；不按节点推算时长，不补写未来情节或私有资料。';
const SOURCE_HINT = '地点来源选用娱乐时间；旧小世界是独立来源，不自动合并两个“家”，不修改住所、位置或用户手写的工具提示。';
const LAUNCH_HINT = '计划和到点只是邀请，不代表出发或游玩。用户与鱼明确决定开始后再核对最新条件；指定作品请用户在娱乐时间故事面板确认开始，面板会核对当前 startStamp / packId / revision。此契约没有 fun_story_start；fun_go 不能指定故事，fun_story 是管理工具，不能代替查询；鱼不能替用户完成 owner 或 joint 中的用户份额。available:true 也不证明没有行程冲突，应由面板重新核对。';
const RECORD_HINT = '收尾按需用 fun_story_current({}) 核对 none/active/draft 和目标行程的 id/runId；none 不表示没有普通出游。只对要回顾的已保存行程用 fun_story_recap({"id":"目标行程ID或runId"})，核对 memory.id/runId，再按 complete、summary、timeline、choices 判断实际进度；不假设存在 state/events。fun_story_recap({}) 只返回最近已存行程，不得当作当前或目标行程。匹配不到时仅复述已确认的事实，不能宣称完成或据此记账。只用已发生摘要，不泄露未来剧情，不当现实通关认证。取消、未出发、暂停、草稿、未完成和试玩都不能称已完成或自动记账。用户明确要记生活时，才用 feast_life_play(activity,note) 写“玩了故事”及实际进度；仅保存成功回执才说记下了。失败或回执不明先核实，复制摘要不等于同步，重复提交没有 sourceRef 幂等或跨日防重保证。';

export const STORY_RECORD_TAIL = '其他生活活动做过了可以照常记；故事须由主人另行明确选择记录，才用 feast_life_play 记对应行程的实际经历。这条邀请不是记账授权。';

export function storyPlanHint() {
  return [
    '【可选故事协作 · 写计划】',
    SOURCE_HINT,
    '仅在考虑相关活动时用 fun_story_places({}) 看地点，需详情再用 {"id":"地点ID"}；用 fun_story_candidates({}) 看无剧透候选，选定后才用 fun_story_detail({"id":"故事ID"})。需要可复制候选时可用 fun_story_schedule({}) 或 {"id":"故事ID"}，其 JSON 内 text 只是候选，不会写日程。按目标时段核对条件，当前可用不保证明天可用；不确定就留弹性。lifeDoings 供明日计划参考，lifeFreeMenu 仅是自由时间邀请。',
    RECEIPT_HINT,
    '现在只用 feast_life_plan 写打算，不加载整篇故事，不在启动或每轮查目录，不新建重复计划；到点仍需明确决定。指定故事由用户到娱乐时间故事面板确认开始，不能用 fun_go 代开，也没有 fun_story_start。计划不移动位置，不记录实际经历。',
  ].join('\n');
}

export function storyFreeHint() {
  return [
    '【可选故事协作 · 自由时间】', SOURCE_HINT,
    '想和主人商量故事时才用 fun_story_places({})、fun_story_candidates({}) 查询无剧透地点与候选，需要详情再按实际 ID 调 fun_story_places({"id":"地点ID"})、fun_story_detail({"id":"故事ID"})；需要复制候选才用 fun_story_schedule({}) 或 {"id":"故事ID"}，JSON 内 text 不是已排日程。不要每轮、启动时查整库或加载整篇故事。',
    RECEIPT_HINT, LAUNCH_HINT, RECORD_HINT,
  ].join('\n');
}

export function linkedMenu(menu, funOn, mapOn, cfg = {}) {
  const base = typeof menu === 'string' ? menu : '';
  if (!storyLinkOn(funOn, cfg)) return withMapLine(withFunLine(base, funOn, cfg), mapOn, cfg);
  // Only omit generated legacy hints. Never filter, rewrite or sort user text.
  const hint = storyFreeHint();
  return base.includes(hint) ? base : [base, hint].filter(Boolean).join('\n');
}
