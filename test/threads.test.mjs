import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, report } from './harness.mjs';
import { addThread, updateThread, threadHint, readThreads, writeThreads } from '../src/life/threads.js';

const TEMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '.tmp');
await mkdir(TEMP_ROOT, { recursive: true });

const initial = { items: [] };
const input = (text, id, source = 'coo') => ({
  text, id, sourceDate: '2026-11-17', sourceActivity: '整理窗台', source, now: 1000,
});
const item = (id, status = 'active') => ({
  id, text: `小事 ${id}`, status, sourceDate: '2026-11-17', sourceActivity: '整理窗台',
  source: 'coo', createdAt: 1, updatedAt: 1,
});

test('addThread：只按显式文字创建并保留来源证据字段', () => {
  const state = addThread(initial, input('给窗台的花换个位置', 't1'));
  assert.equal(state.items.length, 1);
  assert.deepEqual(state.items[0], {
    id: 't1', text: '给窗台的花换个位置', status: 'active', sourceDate: '2026-11-17',
    sourceActivity: '整理窗台', source: 'coo', createdAt: 1000, updatedAt: 1000,
  });
  assert.equal(initial.items.length, 0);
});

test('active 同文去重，容量到八项后明确拒绝', () => {
  let state = initial;
  for (let i = 0; i < 8; i++) state = addThread(state, input(`小事 ${i}`, `t${i}`));
  assert.equal(addThread(state, input(' 小事   0 ', 'duplicate')), state);
  assert.throws(() => addThread(state, input('第九件', 't8')), /最多只能保留 8 件/);
  assert.equal(state.items.length, 8);
});

test('拒绝非法日期、超长字段与不支持的来源', () => {
  assert.throws(() => addThread(initial, { ...input('小事', 'a'), sourceDate: '2026-02-30' }), /合法的 YYYY-MM-DD/);
  assert.throws(() => addThread(initial, { ...input('小事', 'a'), sourceDate: '2026-13-01' }), /合法的 YYYY-MM-DD/);
  assert.throws(() => addThread(initial, input('x'.repeat(121), 'a')), /1-120/);
  assert.throws(() => addThread(initial, { ...input('小事', 'a'), source: 'schedule' }), /source 必须/);
});

test('所有状态入口严格拒绝损坏 item、缺字段及重复 id', async () => {
  for (const state of [
    { items: [null] },
    { items: [{ ...item('x'), text: null }] },
    { items: [{ ...item('x'), sourceDate: '2026-13-01' }] },
    { items: [{ ...item('x'), source: 'schedule' }] },
    { items: [{ ...item('x'), status: 'pending' }] },
    { items: [{ ...item('x'), createdAt: Infinity }] },
    { items: [item('same'), item('same', 'done')] },
  ]) {
    assert.throws(() => threadHint(state), /小事记录损坏/);
    assert.throws(() => addThread(state, input('new', 'new')), /小事记录损坏/);
    assert.throws(() => updateThread(state, { id: 'x', status: 'done' }), /小事记录损坏/);
    await assert.rejects(() => writeThreads(join(TEMP_ROOT, 'invalid'), state), /小事记录损坏/);
  }
});

test('拒绝超过 active/history 限制，add 保活跃且裁剪旧历史', () => {
  assert.throws(() => threadHint({ items: Array.from({ length: 9 }, (_, i) => item(`a${i}`)) }), /进行中的小事最多 8 件/);
  assert.throws(() => addThread({ items: Array.from({ length: 33 }, (_, i) => item(`h${i}`, 'done')) }, input('new', 'new')), /历史小事最多 32 件/);
  let state = { items: [item('active')].concat(Array.from({ length: 32 }, (_, i) => item(`h${i}`, 'done'))) };
  state = addThread(state, input('新小事', 'new'));
  assert.equal(state.items.filter((entry) => entry.status === 'active').length, 2);
  assert.equal(state.items.filter((entry) => entry.status !== 'active').length, 32);
  assert.ok(state.items.some((entry) => entry.id === 'active'));
  assert.ok(state.items.some((entry) => entry.id === 'h0'));
  assert.ok(state.items.some((entry) => entry.id === 'h31'));
});

test('updateThread 只接受明确状态，未知 id 拒绝；历史限制不裁 active', () => {
  let state = { items: Array.from({ length: 35 }, (_, i) => item(`h${i}`, 'done')).concat(item('active')) };
  assert.throws(() => updateThread(state, { id: 'active', status: 'dropped', now: 2000 }), /历史小事最多 32 件/);
  state = { items: [item('active')] };
  state = updateThread(state, { id: 'active', status: 'dropped', now: 2000 });
  assert.equal(state.items.filter((entry) => entry.status === 'active').length, 0);
  assert.equal(state.items.filter((entry) => entry.status !== 'active').length, 1);
  assert.throws(() => updateThread(state, { id: 'missing', status: 'done' }), /unknown thread id/);
  assert.throws(() => updateThread(state, { id: 'active', status: 'scheduled' }), /status 必须/);
});

test('readThreads 对损坏磁盘 item 抛中文错误且不删除原文件', async () => {
  const dataDir = await mkdtemp(join(TEMP_ROOT, 'threads-corrupt-'));
  const file = join(dataDir, 'feast', 'threads.json');
  await mkdir(dirname(file), { recursive: true });
  const damaged = JSON.stringify({ items: [null] });
  await writeFile(file, damaged);
  await assert.rejects(() => readThreads(dataDir), /小事记录损坏，原文件已保留/);
  assert.equal(await readFile(file, 'utf8'), damaged);
});

test('write/read 重启往返保存状态并拒绝覆盖语义损坏的原文件', async () => {
  const dataDir = join(await mkdtemp(join(TEMP_ROOT, 'threads-')), 'companion');
  const state = addThread(initial, input('周末去河边走走', 'walk', 'owner'));
  await writeThreads(dataDir, state);
  assert.deepEqual(await readThreads(dataDir), state);
  const file = join(dataDir, 'feast', 'threads.json');
  const damaged = JSON.stringify({ items: [null] });
  await writeFile(file, damaged);
  await assert.rejects(() => writeThreads(dataDir, initial), /小事记录损坏，原文件已保留/);
  assert.equal(await readFile(file, 'utf8'), damaged);
});

test('threadHint 表明可挑可不挑、主人想法不代表选择，展示 id 与命令', () => {
  const state = addThread(initial, input('周末去河边走走', 'walk', 'owner'));
  const hint = threadHint(state);
  assert.ok(hint.includes('[walk]'));
  assert.ok(hint.includes('周末去河边走走'));
  assert.ok(hint.includes('可继续也可不选'));
  assert.ok(hint.includes('不催促'));
  assert.ok(hint.includes('不把计划当完成'));
  assert.ok(hint.includes('feast_life_thread 的 done/drop'));
  assert.equal(threadHint(initial), '');
});

await report();
