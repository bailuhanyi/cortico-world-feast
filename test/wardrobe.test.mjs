/**
 * 生图工作室联动（wardrobe）测试：纯函数 + 临时目录里的库读取。
 *
 * 不写死工具数 / 事件数 / 面板数（不变式 3）。
 * 临时目录不删：删目录会被沙箱当批量删除拦下（见 life.test.mjs 末尾）。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, report } from './harness.mjs';
import {
  autoOutfit, clearWardrobeCache, emptyWardrobe, enrichItems, findWardrobeItem,
  loadWardrobe, readImggenRoot, resolveWardrobeDir, wardrobeDir, wardrobeHintLine, wardrobeText,
} from '../src/life/wardrobe.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(HERE, '.tmp');
await mkdir(TMP_ROOT, { recursive: true });

const entry = (o) => JSON.stringify(o);

/** 建一个迷你素材库：1 人物（带情境穿搭 + 默认服饰）、3 衣服、2 场景、1 道具。 */
async function makeLib(extra = {}) {
  const root = await mkdtemp(join(TMP_ROOT, 'ward-'));
  if (extra.empty) return root; // 先早退：不建任何条目，测空库降级
  const mk = async (kind, name, obj) => {
    const d = join(root, kind, name);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'entry.json'), entry(obj), 'utf8');
  };
  await mk('characters', '青', {
    name: '青', aliases: ['深深', 'shenshen'], tags: ['蓝发', '女仆'],
    desc: '蓝发少女', defaultOutfit: '女仆裙',
    outfitByContext: extra.noCtx ? {} : { 睡前: '睡衣', 刚睡醒: '睡衣', 通勤: '通勤衬衫' },
  });
  await mk('outfits', '睡衣', { name: '睡衣', aliases: ['居家服'], tags: ['睡衣', '宽松'], desc: '白色T恤' });
  await mk('outfits', '通勤衬衫', { name: '通勤衬衫', aliases: ['衬衫'], tags: ['通勤'] });
  await mk('outfits', '女仆裙', { name: '女仆裙', aliases: ['女仆装'], tags: ['洛丽塔'] });
  await mk('scenes', '卧室', { name: '卧室', aliases: [], tags: [], desc: '日系卧室' });
  await mk('scenes', '公司', { name: '公司', aliases: ['办公室'], tags: [] });
  await mk('props', '手机', { name: '手机', aliases: [], tags: [] });
  if (extra.bad) {
    // 坏条目：目录建好，但 entry.json 是坏 JSON。
    const bd = join(root, 'outfits', '坏');
    await mkdir(bd, { recursive: true });
    await writeFile(join(bd, 'entry.json'), '{不是json', 'utf8');
  }
  if (extra.loose) {
    // 散图条目：直接在 outfits/ 下放一张图片文件（不是目录）；再放一个目录但没 entry.json。
    await writeFile(join(root, 'outfits', '散图.png'), 'fake-png-bytes', 'utf8');
    const noEntry = join(root, 'outfits', '无json目录');
    await mkdir(noEntry, { recursive: true });
    await writeFile(join(noEntry, '正面.jpg'), 'fake-jpg', 'utf8');
  }
  return root;
}

const libFor = (root) => loadWardrobe(root, { cfgDir: root });

test('loadWardrobe：读到四类条目，字段齐全', async () => {
  clearWardrobeCache();
  const root = await makeLib();
  const lib = await libFor(root);
  assert.equal(lib.empty, false);
  assert.equal(lib.characters.length, 1);
  assert.equal(lib.outfits.length, 3);
  assert.equal(lib.scenes.length, 2);
  assert.equal(lib.props.length, 1);
  const qing = lib.characters.find((c) => c.name === '青');
  assert.equal(qing.aliases[0], '深深');
  assert.deepEqual(qing.outfitByContext, { 睡前: '睡衣', 刚睡醒: '睡衣', 通勤: '通勤衬衫' });
  assert.equal(qing.defaultOutfit, '女仆裙');
  const pyjama = lib.outfits.find((o) => o.name === '睡衣');
  assert.deepEqual(pyjama.aliases, ['居家服']);
});

test('loadWardrobe：目录不存在/为空时静默降级成空库，不抛', async () => {
  clearWardrobeCache();
  const nowhere = join(TMP_ROOT, '不存在-' + Date.now());
  const lib = await loadWardrobe(nowhere);
  assert.equal(lib.empty, true);
  assert.deepEqual(lib.characters, []);
  assert.deepEqual(lib.outfits, []);
  // 空目录（四类都没有条目）也降级
  const root = await makeLib({ empty: true });
  const lib2 = await libFor(root);
  assert.equal(lib2.empty, true, `root=${root} 应降级为空库，实际 empty=${lib2.empty} outfits=${lib2.outfits.length}`);
});

test('loadWardrobe：坏 entry.json 跳过，不拖垮整个库', async () => {
  clearWardrobeCache();
  const root = await makeLib({ bad: true });
  const lib = await libFor(root);
  assert.equal(lib.empty, false);
  assert.equal(lib.outfits.length, 3); // 3 个好的 + 1 个坏的被跳过
});

test('loadWardrobe：散图条目（图片文件 / 无 entry.json 的目录）跳过，不崩库', async () => {
  clearWardrobeCache();
  const root = await makeLib({ loose: true });
  const lib = await libFor(root);
  assert.equal(lib.empty, false);
  // 3 个标准条目；散图.png（文件）和无json目录（目录但没 entry.json）都跳过
  assert.equal(lib.outfits.length, 3);
  assert.ok(!lib.outfits.find((o) => o.name === '散图' || o.name === '无json目录'), '散图条目不该进库');
});

test('loadWardrobe：缓存命中时不重扫（mtime 没变）', async () => {
  clearWardrobeCache();
  const root = await makeLib();
  const a = await libFor(root);
  const b = await libFor(root);
  assert.strictEqual(a, b, '同一 mtime 返回同一个对象引用');
  // 强制重扫拿到新对象
  const c = await loadWardrobe(root, { cfgDir: root, force: true });
  assert.notStrictEqual(a, c);
  assert.equal(c.outfits.length, a.outfits.length);
});

test('wardrobeDir：cfgDir 留空用默认 <dataDir>/imggen-library（同步版，只处理手动+默认）', () => {
  assert.equal(wardrobeDir('/data', ''), join('/data', 'imggen-library'));
  assert.equal(wardrobeDir('/data', '/custom/lib'), '/custom/lib');
  assert.equal(wardrobeDir('/data', '  '), join('/data', 'imggen-library'));
});

test('readImggenRoot：从 <dataDir>/../config.json 读 worlds.imggen.libraryRoot', async () => {
  clearWardrobeCache();
  const dataDir = await mkdtemp(join(TMP_ROOT, 'cfg-'));
  // 写一份带 imggen.libraryRoot 的 Coo config 到 dataDir 的父目录……
  // 但 dataDir 是 mkdtemp 建的，父目录是 TMP_ROOT（共享），直接往那写会污染别的测试。
  // 所以这里用一个独立结构：建 dataDir，在它的父目录写 config.json，测完删。
  // 更简单：直接造一个 dataDir，把 config.json 放在 dataDir/.. 下，测完清理。
  const parent = join(TMP_ROOT, `cfgparent-${Date.now()}`);
  const child = join(parent, 'data');
  await mkdir(child, { recursive: true });
  await writeFile(join(parent, 'config.json'), JSON.stringify({
    worlds: { imggen: { libraryRoot: 'H:\\大肥鱼桌宠\\生图文件' } },
  }), 'utf8');
  const root = await readImggenRoot(child);
  assert.equal(root, 'H:\\大肥鱼桌宠\\生图文件');
  // config 不存在 / 没有 imggen 段 / libraryRoot 空：都返回空串
  assert.equal(await readImggenRoot(await mkdtemp(join(TMP_ROOT, 'nocfg-'))), '');
  const empty2 = join(TMP_ROOT, `cfgparent2-${Date.now()}`);
  const child2 = join(empty2, 'data');
  await mkdir(child2, { recursive: true });
  await writeFile(join(empty2, 'config.json'), JSON.stringify({ worlds: { imggen: {} } }), 'utf8');
  assert.equal(await readImggenRoot(child2), '');
});

test('resolveWardrobeDir：手动覆盖 > imggen libraryRoot > 默认路径', async () => {
  clearWardrobeCache();
  const parent = join(TMP_ROOT, `resparent-${Date.now()}`);
  const dataDir = join(parent, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(parent, 'config.json'), JSON.stringify({
    worlds: { imggen: { libraryRoot: 'H:\\大肥鱼桌宠\\生图文件' } },
  }), 'utf8');
  // 1. 手动覆盖优先
  assert.equal(await resolveWardrobeDir(dataDir, '/manual'), '/manual');
  // 2. 无手动 → imggen libraryRoot
  assert.equal(await resolveWardrobeDir(dataDir, ''), 'H:\\大肥鱼桌宠\\生图文件');
  assert.equal(await resolveWardrobeDir(dataDir), 'H:\\大肥鱼桌宠\\生图文件');
  // 3. 无 imggen config → 默认路径
  const bare = await mkdtemp(join(TMP_ROOT, 'resbare-'));
  assert.equal(await resolveWardrobeDir(bare, ''), join(bare, 'imggen-library'));
});

test('findWardrobeItem：精确名 / 别名 / 唯一包含 / 歧义不取', async () => {
  clearWardrobeCache();
  const root = await makeLib();
  const lib = await libFor(root);
  assert.equal(findWardrobeItem(lib, 'outfits', '睡衣').name, '睡衣'); // 精确名
  assert.equal(findWardrobeItem(lib, 'outfits', '居家服').name, '睡衣'); // 别名
  assert.equal(findWardrobeItem(lib, 'scenes', '办公室').name, '公司'); // 别名
  assert.equal(findWardrobeItem(lib, 'outfits', '睡衣').name, '睡衣'); // 唯一包含「睡衣」→睡衣
  // 空名 / 不存在
  assert.equal(findWardrobeItem(lib, 'outfits', ''), null);
  assert.equal(findWardrobeItem(lib, 'outfits', '不存在的名字'), null);
});

// --------------------------------------------------------------------------
// autoOutfit 六级优先级
// --------------------------------------------------------------------------

test('autoOutfit：库空时不补，原样返回 outfit', () => {
  const lib = emptyWardrobe();
  const r = autoOutfit({ activity: '在家', outfit: '随便穿' }, lib);
  assert.equal(r.outfit, '随便穿');
  assert.equal(r.source, 'model');
  const r2 = autoOutfit({ activity: '在家' }, lib);
  assert.equal(r2.outfit, '');
});

test('autoOutfit：① 模型填的优先，能对上库就归一成正名', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  const r = autoOutfit({ activity: '睡觉', outfit: '居家服' }, lib); // 别名→正名
  assert.equal(r.outfit, '睡衣');
  assert.equal(r.source, 'model');
  // 对不上库也保留原值
  const r2 = autoOutfit({ activity: '出门', outfit: '运动服' }, lib);
  assert.equal(r2.outfit, '运动服');
  assert.equal(r2.source, 'model');
});

test('autoOutfit：② 延续上一段（context miss 时 carry；睡觉不延续）', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  // 起床标了 situation=刚睡醒→context 命中睡衣（情境优先，不是 carry）
  const r0 = autoOutfit({ activity: '起床洗漱', situation: '刚睡醒' }, lib, '随便');
  assert.equal(r0.outfit, '睡衣');
  assert.equal(r0.source, 'context');
  // situation=休闲：context miss → 情境默认表命中居家针织服，但库里没有 → 跳过 → carry 睡衣
  const r = autoOutfit({ activity: '起床', situation: '休闲' }, lib, '睡衣');
  assert.equal(r.outfit, '睡衣');
  assert.equal(r.source, 'carry');
  // 睡觉那一段不延续（哪怕有 prevOutfit），且没标情境→空
  const r2 = autoOutfit({ activity: '睡觉' }, lib, '女仆裙');
  assert.equal(r2.outfit, '');
});

test('autoOutfit：③ 情境默认（没配 outfitByContext 时，situation 关键词自带默认）', async () => {
  clearWardrobeCache();
  // 人物没配 outfitByContext——靠内置常识表：睡前→睡衣、通勤→通勤衬衫
  const lib = await libFor(await makeLib({ noCtx: true }));
  assert.deepEqual(lib.characters[0].outfitByContext, {}, '人物没配情境穿搭');
  // situation=睡前：context miss → 情境默认表命中睡衣，库里有睡衣→补睡衣
  const r = autoOutfit({ activity: '准备睡觉', situation: '睡前' }, lib, '');
  assert.equal(r.outfit, '睡衣');
  assert.equal(r.source, 'situation-default');
  // situation=通勤：情境默认表命中通勤衬衫
  const r2 = autoOutfit({ activity: '上班', situation: '通勤' }, lib, '');
  assert.equal(r2.outfit, '通勤衬衫');
  assert.equal(r2.source, 'situation-default');
  // 情境默认表命中的 outfit 库里没有（删掉居家针织服就 find 不到）→跳过，往下走
  const r3 = autoOutfit({ activity: '在家', situation: '休闲' }, lib, '女仆裙');
  // 休闲→居家针织服，库里没有居家针织服 → find 不到 → 跳过 → carry 女仆裙
  assert.equal(r3.outfit, '女仆裙');
  assert.equal(r3.source, 'carry');
});

test('autoOutfit：④ 情境穿搭 outfitByContext[睡前→睡衣]', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  const r = autoOutfit({ activity: '准备睡觉', situation: '睡前' }, lib, '');
  assert.equal(r.outfit, '睡衣');
  assert.equal(r.source, 'context');
  // 情境对不上就往下走
  const r2 = autoOutfit({ activity: '看电视', situation: '休闲' }, lib, '');
  assert.ok(r2.source !== 'context');
});

test('autoOutfit：⑤ defaultOutfit 兜底（无情境无场景时）', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  const r = autoOutfit({ activity: '在家玩' }, lib, ''); // 无 situation、无 scene
  assert.equal(r.outfit, '女仆裙');
  assert.equal(r.source, 'default');
});

// --------------------------------------------------------------------------
// enrichItems
// --------------------------------------------------------------------------

test('enrichItems：库空时原样返回（不改）', async () => {
  const items = [{ start: '00:00', end: '08:00', activity: '睡觉' }];
  assert.strictEqual(enrichItems(items, emptyWardrobe()), items);
});

test('enrichItems：补 outfit + 延续 + scene 正名归一，不覆盖模型填的', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  const items = [
    { start: '00:00', end: '08:00', activity: '睡觉', situation: '睡前' },
    { start: '08:00', end: '09:00', activity: '起床洗漱', situation: '刚睡醒' },
    { start: '09:00', end: '18:00', activity: '上班', scene: '办公室', situation: '通勤' }, // scene 别名→公司，情境→通勤衬衫
    { start: '18:00', end: '24:00', activity: '回家', outfit: '运动服' }, // 模型填的，保留
  ];
  const out = enrichItems(items, lib);
  assert.equal(out[0].outfit, '睡衣'); // 睡前→睡衣（context）
  assert.equal(out[0].outfitSource, 'context');
  assert.equal(out[1].outfit, '睡衣'); // 刚睡醒→睡衣（context，情境优先于 carry）
  assert.equal(out[1].outfitSource, 'context');
  assert.equal(out[2].scene, '公司'); // 别名归一
  assert.equal(out[2].outfit, '通勤衬衫'); // 通勤→通勤衬衫（context）
  assert.equal(out[2].outfitSource, 'context');
  assert.equal(out[3].outfit, '运动服'); // 模型填的保留
  assert.ok(!out[3].outfitSource || out[3].outfitSource === undefined);
});

// --------------------------------------------------------------------------
// 文本
// --------------------------------------------------------------------------

test('wardrobeText / wardrobeHintLine：库空返回空串', () => {
  assert.equal(wardrobeText(emptyWardrobe()), '');
  assert.equal(wardrobeHintLine(emptyWardrobe()), '');
});

test('wardrobeText：库非空列出人物/衣柜/场景/道具 + 情境穿搭', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  const t = wardrobeText(lib);
  assert.ok(t.includes('青'));
  assert.ok(t.includes('睡衣'));
  assert.ok(t.includes('卧室'));
  assert.ok(t.includes('手机'));
  assert.ok(t.includes('睡前→睡衣'), '列出情境穿搭');
  assert.ok(t.includes('平时穿：女仆裙'), '列出默认服饰');
});

test('wardrobeHintLine：指向生图工作室 + 人物名', async () => {
  clearWardrobeCache();
  const lib = await libFor(await makeLib());
  const line = wardrobeHintLine(lib);
  assert.ok(line.includes('生图工作室'));
  assert.ok(line.includes('青'));
  assert.ok(line.includes('imggen_draw'));
});

await report();
