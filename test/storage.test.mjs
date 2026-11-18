import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, report } from './harness.mjs';
import { inspectStoredJson, readStoredJson, restoreStoredJson, writeStoredJson } from '../src/storage.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'feed-world-storage-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('readStoredJson：缺失为 null，损坏与目录 I/O 错误明确抛出', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'state.json');
    assert.equal(await readStoredJson(file), null);
    await writeFile(file, '{bad');
    await assert.rejects(readStoredJson(file), /记录损坏/);
    await assert.rejects(readStoredJson(dir), /读取失败/);
  });
});

test('首次写入允许无原档，后续写入备份旧有效 JSON', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'state.json');
    assert.equal((await writeStoredJson(file, { n: 1 })).status, 'ok');
    await writeStoredJson(file, { n: 2 });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { n: 2 });
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), { n: 1 });
  });
});

test('坏主档拒绝覆盖，且不会污染已有有效备份', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'state.json');
    await writeFile(file, '{broken');
    await writeFile(`${file}.bak`, '{"safe":true}');
    await assert.rejects(writeStoredJson(file, { replacement: true }), /拒绝覆盖/);
    assert.equal(await readFile(file, 'utf8'), '{broken');
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), { safe: true });
  });
});

test('目录写入及备份不可写时保留现有数据并报告 I/O 错误', async () => {
  await withDir(async (dir) => {
    const subdir = join(dir, 'record-dir');
    await mkdir(subdir);
    await assert.rejects(writeStoredJson(subdir, { n: 1 }), /读取失败/);
    const file = join(dir, 'state.json');
    await writeFile(file, '{"n":1}');
    await mkdir(`${file}.bak`);
    await assert.rejects(writeStoredJson(file, { n: 2 }), /备份失败/);
    assert.equal(await readFile(file, 'utf8'), '{"n":1}');
  });
});

test('检查状态反映主档及备份有效性', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'state.json');
    assert.deepEqual(await inspectStoredJson(file), { status: 'missing', backupAvailable: false, message: '主记录不存在' });
    await writeFile(`${file}.bak`, '[]');
    assert.equal((await inspectStoredJson(file)).backupAvailable, true);
    await writeFile(file, 'oops');
    const damaged = await inspectStoredJson(file);
    assert.equal(damaged.status, 'error');
    assert.equal(damaged.backupAvailable, true);
    await writeFile(`${file}.bak`, 'oops');
    assert.equal((await inspectStoredJson(file)).backupAvailable, false);
  });
});

test('恢复前逐字保留原档到唯一文件；无效备份拒绝恢复', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'state.json');
    const damaged = '{damaged exactly';
    await writeFile(file, damaged);
    await writeFile(`${file}.bak`, '{"restored":true}');
    await restoreStoredJson(file);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { restored: true });
    const preserved = (await readdir(dir)).filter((name) => name.startsWith('state.json.corrupt-'));
    assert.equal(preserved.length, 1);
    assert.equal(await readFile(join(dir, preserved[0]), 'utf8'), damaged);
    await writeFile(`${file}.bak`, '{bad backup');
    const before = await readFile(file, 'utf8');
    await assert.rejects(restoreStoredJson(file), /备份无效/);
    assert.equal(await readFile(file, 'utf8'), before);
  });
});

await report();
