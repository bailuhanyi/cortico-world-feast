import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, report } from './harness.mjs';
import { DEFAULTS, EVENT_LIFE_FREE, EVENT_LIFE_PLAN } from '../src/config.js';
import { addDays, playPath, readDay, readPlay } from '../src/life/index.js';
import { linkedMenu } from '../src/life/storylink.js';
import { FeastWorld } from '../src/world.js';

const TMP = fileURLToPath(new URL('./.tmp/', import.meta.url));
await mkdir(TMP, { recursive: true });
const DAY = '2026-11-05', TOMORROW = addDays(DAY, 1);
const at = (hm) => Date.parse(`${DAY}T${hm}:00+08:00`);
const MENU = '- 先给阳台浇水\n  保留缩进与标点！\n\n- 然后听唱片';
const HANDWRITTEN = `${MENU}\n- 手写 map_look 备忘\n- 手写 fun_go 备忘`;
const STORY = /\bfun_story_candidates\b/, LEGACY_FUN = /\bfun_places\b/, LEGACY_MAP = /\bmap_places\b/;
const ENTRY = { activity: '玩了故事', note: '走到第一幕，停在桥边' };
const ON = { enabled: true }, BOTH = { fun: ON, map: ON }, STORY_ON = { lifeStoryOn: true };
async function removeBlocker(path) {
  assert.ok(resolve(path).startsWith(resolve(TMP) + sep), 'only remove this test-owned blocker');
  assert.match(path, /play-\d{4}-\d{2}-\d{2}\.json$/);
  await rmdir(path); // only an empty directory created by this test
}
async function withWorld({ worlds = BOTH, cfg = STORY_ON } = {}, exercise) {
  const botDir = await mkdtemp(join(TMP, 'storylink-'));
  const dataDir = join(botDir, 'data'); await mkdir(dataDir);
  await writeFile(join(botDir, 'config.json'), JSON.stringify({ worlds }));
  let now = at('20:55'); const events = [], ticks = [];
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true, weatherEnabled: false, lifeWardrobeOn: false, lifeDayType: 'workday',
      lifeFreeMenu: MENU, lifeFreeSlots: '21:00', lifeGenerateAt: '20:56', ...cfg },
    botDir, dataDir, timezone: 'Asia/Shanghai', now: () => now, random: () => 0.5,
    timers: { setInterval(fn) { return ticks.push(fn); }, clearInterval() {}, setTimeout() {} },
  });
  const host = { log: { info() {}, warn() {}, debug() {} }, async pushEvent(event) { events.push(event); return { ...event, cursor: events.length }; } };
  try {
    await world.start(host);
    const tools = Object.fromEntries(world.tools().map(({ name, handler }) => [name, handler]));
    const tick = async (hm) => { now = at(hm); assert.ok(ticks.length); for (const run of ticks) await run(); await tools.feast_history({}); };
    await exercise({ world, tools, tick, dataDir, ofType: (type) => events.filter((e) => e.type === type), panel: (method) => world.webUi('zh').invoke('today', method, []) });
  } finally { await world.stop(); }
}
function assertLinks(text, [story, fun, map]) {
  for (const [marker, expected] of [[STORY, story], [LEGACY_FUN, fun], [LEGACY_MAP, map]]) assert.equal(marker.test(text), expected, `提示 ${marker} 开关错误：\n${text}`);
}
const cases = [
  ['默认关闭保留旧双边联动', BOTH, {}, [false, true, true]],
  ['无插件', {}, STORY_ON, [false, false, false]],
  ['仅 fun', { fun: ON }, STORY_ON, [true, false, false]],
  ['仅 map', { map: ON }, STORY_ON, [false, false, true]],
  ['双边启用时隐藏自动旧提示', BOTH, STORY_ON, [true, false, false]],
  ['fun 配置禁用时回到旧 map', { fun: { enabled: false }, map: ON }, STORY_ON, [false, false, true]],
  ['旧 fun 开关关闭时回到旧 map', BOTH, { ...STORY_ON, lifeFreeFunOn: false }, [false, false, true]],
  ['旧 map 开关仍控制旧路径', BOTH, { lifeStoryOn: false, lifeFreeMapOn: false }, [false, true, false]],
  ['旧 map 开关不约束故事路径', BOTH, { ...STORY_ON, lifeFreeMapOn: false }, [true, false, false]],
];
for (const [label, worlds, cfg, expected] of cases) test(`计划和三个自由入口按配置联动：${label}`, async () => {
  await withWorld({ worlds, cfg }, async ({ tools, tick, panel, ofType }) => {
    await tick('21:02'); const [plan] = ofType(EVENT_LIFE_PLAN), [scheduled] = ofType(EVENT_LIFE_FREE);
    assert.ok(plan); assert.ok(scheduled); assertLinks(plan.text, expected); assert.doesNotMatch(plan.text, /先给阳台浇水/);
    const tool = await tools.feast_life_start({}); assert.ok(!tool.failed, tool.text);
    const reply = await panel('freeStart'); assert.ok(reply.ok, reply.message);
    const panelEvent = ofType(EVENT_LIFE_FREE).find((e) => e.meta?.reason === 'owner-start'); assert.ok(panelEvent);
    for (const { text } of [scheduled, tool, panelEvent]) { assert.ok(text.includes(MENU)); assertLinks(text, expected); if (expected[1] && expected[2]) assert.ok(text.search(LEGACY_FUN) < text.search(LEGACY_MAP)); }
  });
});
test('手写 fun/map 原文保留，重复拼接只产生一份故事引导', async () => {
  const combined = linkedMenu(HANDWRITTEN, true, true, STORY_ON); assert.ok(combined.startsWith(`${HANDWRITTEN}\n`)); assert.match(combined, STORY);
  assert.equal(linkedMenu(combined, true, true, STORY_ON), combined);
  await withWorld({ cfg: { ...STORY_ON, lifeFreeMenu: combined } }, async ({ tools, panel, ofType, tick }) => {
    await tick('21:02'); const tool = await tools.feast_life_start({}); assert.ok(!tool.failed, tool.text);
    assert.ok((await panel('freeStart')).ok); assert.equal(ofType(EVENT_LIFE_FREE).length, 2);
    for (const { text } of [...ofType(EVENT_LIFE_FREE), tool]) { assert.ok(text.includes(HANDWRITTEN)); assert.equal(text.match(/\bfun_story_candidates\b/g)?.length, 1); assert.doesNotMatch(text, LEGACY_MAP); assert.doesNotMatch(text, LEGACY_FUN); }
  });
});
test('计划、到点、工具、面板只邀请，重复 tick 不重发或登记经历', async () => {
  await withWorld({}, async ({ dataDir, tools, tick, panel, ofType }) => {
    const today = await readDay(dataDir, DAY); await tick('20:57'); const plans = ofType(EVENT_LIFE_PLAN);
    assert.equal(plans.length, 1); assert.match(plans[0].text, /当前会话实际声明相应工具/); assert.match(plans[0].text, /只用 feast_life_plan 写打算/);
    const pending = await readDay(dataDir, TOMORROW); assert.equal(pending.source, 'pending'); assert.deepEqual(pending.items, []); assert.equal(await readPlay(dataDir, DAY), null);
    const tool = await tools.feast_life_start({}); assert.ok(!tool.failed, tool.text); assert.equal(ofType(EVENT_LIFE_FREE).length, 0);
    assert.ok((await panel('freeStart')).ok); assert.equal(ofType(EVENT_LIFE_FREE).length, 1); assert.equal(await readPlay(dataDir, DAY), null);
    await tick('21:02'); await tick('21:03'); await tick('21:10'); assert.equal(ofType(EVENT_LIFE_PLAN).length, 1);
    const free = ofType(EVENT_LIFE_FREE); assert.equal(free.length, 2); assert.equal(free[1].meta.slot, '21:00');
    for (const { text } of [...free, tool]) { assert.match(text, /邀请.{0,10}不代表出发或游玩/); assert.match(text, /用户.{0,10}故事面板确认开始/); assert.match(text, /用户明确要记生活时.{0,12}feast_life_play/); assert.match(text, /仅保存成功回执才说记下/); assert.match(text, /重复提交没有 sourceRef 幂等/); }
    const play = await readPlay(dataDir, DAY); assert.ok(play.fired['21:00']); assert.deepEqual(play.done, []);
    assert.equal(await readPlay(dataDir, TOMORROW), null); assert.deepEqual(await readDay(dataDir, DAY), today); assert.deepEqual(await readDay(dataDir, TOMORROW), pending);
  });
});
for (const entry of ['tool', 'panel']) test(`取消邀请并跳过剩余档位不登记经历（${entry}）`, async () => {
  await withWorld({ cfg: { ...STORY_ON, lifeFreeSlots: '21:00,21:15' } }, async ({ dataDir, tools, tick, panel, ofType }) => {
    await tick('21:02'); assert.match(ofType(EVENT_LIFE_FREE)[0].text, /取消.{0,45}不能称已完成或自动记账/);
    const result = entry === 'tool' ? await tools.feast_life_skip({ reason: '取消，今天不出门' }) : await panel('freeSkip'); assert.ok(entry === 'tool' ? !result.failed : result.ok);
    await tick('21:16'); assert.equal(ofType(EVENT_LIFE_FREE).length, 1); const play = await readPlay(dataDir, DAY); assert.equal(play.skipped, true); assert.deepEqual(play.done, []);
  });
});
test('空 activity 拒绝，相同显式提交可记两笔且回执报实际件数', async () => {
  await withWorld({}, async ({ dataDir, tools }) => {
    const invalid = await tools.feast_life_play({ activity: '   ', note: ENTRY.note }); assert.equal(invalid.failed, true); assert.match(invalid.text, /activity/); assert.equal(await readPlay(dataDir, DAY), null);
    for (let count = 1; count <= 2; count++) { const receipt = await tools.feast_life_play(ENTRY); assert.ok(!receipt.failed, receipt.text); assert.match(receipt.text, /玩了故事/); assert.match(receipt.text, new RegExp(`今天记了 ${count} 件`)); const saved = await readPlay(dataDir, DAY); assert.deepEqual(saved.done.map(({ activity, note }) => ({ activity, note })), Array(count).fill(ENTRY)); }
  });
});
test('显式记账写入失败不改变计数，路径恢复后只保留成功的一笔', async () => {
  await withWorld({}, async ({ dataDir, tools }) => {
    const path = playPath(dataDir, DAY); await mkdir(path);
    try { const failed = await tools.feast_life_play(ENTRY); assert.equal(failed.failed, true); assert.doesNotMatch(failed.text, /今天记了 [1-9]\d* 件/); const start = await tools.feast_life_start({}); assert.ok(!start.failed, start.text); assert.match(start.text, /今天已经记了 0 件/); } finally { await removeBlocker(path); }
    assert.equal(await readPlay(dataDir, DAY), null); const retry = await tools.feast_life_play(ENTRY); assert.ok(!retry.failed, retry.text); assert.match(retry.text, /今天记了 1 件/); assert.deepEqual((await readPlay(dataDir, DAY)).done, [{ at: at('20:55'), ...ENTRY }]);
  });
});
test('提醒存储受阻后，成功显式记账保留提醒状态和新经历', async () => {
  await withWorld({}, async ({ dataDir, tools, tick, ofType }) => {
    const path = playPath(dataDir, DAY); await mkdir(path);
    try { await tick('21:02'); assert.equal(ofType(EVENT_LIFE_FREE).length, 1); } finally { await removeBlocker(path); }
    assert.equal(await readPlay(dataDir, DAY), null); const receipt = await tools.feast_life_play(ENTRY); assert.ok(!receipt.failed, receipt.text);
    const saved = await readPlay(dataDir, DAY); assert.ok(saved.fired['21:00']); assert.deepEqual(saved.done, [{ at: at('21:02'), ...ENTRY }]);
    await tick('21:03'); assert.equal(ofType(EVENT_LIFE_FREE).length, 1); assert.deepEqual(await readPlay(dataDir, DAY), saved);
  });
});
test('故事提示只在邀请中，envPromptVars 不随故事开关变化', async () => {
  await withWorld({}, async ({ world, tick, ofType }) => { await tick('21:02'); assert.match(ofType(EVENT_LIFE_PLAN)[0].text, STORY); assert.match(ofType(EVENT_LIFE_FREE)[0].text, STORY); const enabled = world.envPromptVars(); assert.ok(enabled.feast_life_block); world.cfg.lifeStoryOn = false; assert.deepEqual(world.envPromptVars(), enabled); assert.doesNotMatch(JSON.stringify(enabled), /fun_story_|可选故事协作/); });
});
test('实际无业务工具的宿主仍给条件降级指引，不推断查询或完成', async () => {
  await withWorld({}, async ({ tools }) => {
    const reply = await tools.feast_life_start({}); assert.ok(!reply.failed);
    for (const marker of ['ok===true','enabled===true 且 available===true','已知存档异常','failed:true','ok:false','缺失/畸形 text','权限不明','无候选','过期不可用','普通生活邀请','时长就说明未知','不按节点推算时长','没有 fun_story_start','fun_story 是管理工具','none/active/draft','取消、未出发、暂停、草稿、未完成和试玩','复制摘要不等于同步']) assert.ok(reply.text.includes(marker), marker);
  });
});
test('新路径三个自由入口保留菜单首尾空白原文', async () => {
  const padded = `  ${MENU}\n  `;
  await withWorld({ cfg: { ...STORY_ON, lifeFreeMenu: padded } }, async ({ tools, tick, panel, ofType }) => {
    await tick('21:02');
    const tool = await tools.feast_life_start({});
    assert.ok((await panel('freeStart')).ok);
    for (const entry of [...ofType(EVENT_LIFE_FREE), tool]) assert.ok(entry.text.includes(padded), '原文首尾空白须保留');
  });
});
test('收尾必须匹配本局行程，三个自由入口均不把邀请当作记录授权', async () => {
  await withWorld({}, async ({ tools, tick, panel, ofType }) => {
    await tick('21:02');
    const tool = await tools.feast_life_start({});
    assert.ok(!tool.failed);
    assert.ok((await panel('freeStart')).ok);
    const reminders = ofType(EVENT_LIFE_FREE);
    assert.equal(reminders.length, 2);
    for (const { text } of [...reminders, tool]) {
      assert.ok(text.includes('fun_story_recap({"id":"目标行程ID或runId"})'));
      assert.match(text, /核对 memory.id\/runId/);
      assert.match(text, /只返回最近已存行程，不得当作当前或目标行程/);
      assert.match(text, /匹配不到时仅复述已确认的事实，不能宣称完成或据此记账/);
      assert.match(text, /其他生活活动做过了可以照常记；故事须由主人另行明确选择记录/);
      assert.match(text, /这条邀请不是记账授权/);
      assert.doesNotMatch(text, /做完随手用 feast_life_play|想记就用 feast_life_play/);
    }
  });
});
test('D2 到点提醒把日程中的地点标为计划，不宣称实际所在', async () => {
  await withWorld({}, async ({ tools, tick, ofType }) => {
    await tick('20:55');
    const result = await tools.feast_life_adjust({ start: '20:55', end: '22:00', activity: '自己的时间', location: '计划中的码头' });
    assert.ok(!result.failed, result.text);
    await tick('21:02');
    const [event] = ofType(EVENT_LIFE_FREE);
    assert.ok(event);
    assert.match(event.text, /日程原本安排：[^\n]+计划中的码头[^\n]+实际所在地点以核实为准/);
    assert.doesNotMatch(event.text, /你现在在计划中的码头/);
  });
});
await report();
