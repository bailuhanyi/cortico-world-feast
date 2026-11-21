import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, report } from './harness.mjs';
import { readLinkedWorldEnabled } from '../src/life/linked-config.js';
import { readFunEnabled } from '../src/life/funlink.js';
import { readMapEnabled } from '../src/life/maplink.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'linked-config-tests');
await mkdir(root, { recursive: true });
const config = (world, enabled) => JSON.stringify({ worlds: { [world]: { enabled } } });
const ioError = (code) => Object.assign(new Error(code), { code });
async function fixture() {
  const dir = await mkdtemp(join(root, 'case-'));
  const dataDir = join(dir, 'store');
  const botDir = join(dir, 'deployment');
  await mkdir(dataDir); await mkdir(botDir);
  return { dataDir, botDir, current: join(dataDir, 'config.json'), parent: join(dir, 'config.json'), authoritative: join(botDir, 'config.json') };
}
function observe(read) {
  const calls = [], pauses = [];
  return {
    calls, pauses,
    readText: async (path, encoding) => { calls.push(path); assert.equal(encoding, 'utf8'); return read(path, calls.length); },
    pause: async (ms) => { pauses.push(ms); },
  };
}

for (const [world, enabled] of [['fun', readFunEnabled], ['map', readMapEnabled]]) {
  test(`${world}: 数据目录内的配置独立可用，读取不修改原文`, async () => {
    const f = await fixture();
    const original = config(world, true);
    await writeFile(f.current, original);
    assert.equal(await enabled(f.dataDir), true);
    assert.equal(await readFile(f.current, 'utf8'), original);
  });

  test(`${world}: 当前配置缺失时兼容旧父目录布局`, async () => {
    const f = await fixture();
    await writeFile(f.parent, config(world, true));
    assert.equal(await enabled(f.dataDir), true);
  });

  test(`${world}: 当前明确禁用时不能被父目录旧 true 覆盖`, async () => {
    const f = await fixture();
    await writeFile(f.current, config(world, false));
    await writeFile(f.parent, config(world, true));
    assert.equal(await enabled(f.dataDir), false);
  });

  test(`${world}: 当前缺段、坏字段或非布尔值均权威降级为 false`, async () => {
    const f = await fixture();
    await writeFile(f.parent, config(world, true));
    for (const value of ['{}', 'null', '[]', JSON.stringify({ worlds: { other: { enabled: true } } }),
      config(world, 'true'), config(world, 1), config(world, null), config(world, false)]) {
      await writeFile(f.current, value);
      assert.equal(await enabled(f.dataDir), false, value);
    }
  });

  test(`${world}: 损坏 JSON 只重试权威文件一次，不尝试旧副本`, async () => {
    const f = await fixture();
    const io = observe(async (path) => path === f.current ? '{写入未完成' : config(world, true));
    assert.equal(await enabled(f.dataDir, io), false);
    assert.deepEqual(io.calls, [f.current, f.current]);
    assert.deepEqual(io.pauses, [200]);
  });

  test(`${world}: 不可读配置有限重试并降级，不因旧配置启用`, async () => {
    const f = await fixture();
    for (const code of ['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR']) {
      const io = observe(async (path) => { if (path === f.current) throw ioError(code); return config(world, true); });
      assert.equal(await enabled(f.dataDir, io), false, code);
      assert.deepEqual(io.calls, [f.current, f.current], code);
      assert.deepEqual(io.pauses, [200], code);
    }
  });

  test(`${world}: 临时坏 JSON 恢复后使用同一配置的新值`, async () => {
    const f = await fixture();
    const io = observe(async (path, count) => { assert.equal(path, f.current); return count === 1 ? '{' : config(world, true); });
    assert.equal(await enabled(f.dataDir, io), true);
    assert.deepEqual(io.calls, [f.current, f.current]);
    assert.deepEqual(io.pauses, [200]);
  });

  test(`${world}: 已见过损坏文件后即使重试 ENOENT 也不转读父目录`, async () => {
    const f = await fixture();
    const io = observe(async (path, count) => {
      if (path !== f.current) return config(world, true);
      if (count === 1) return '{';
      throw ioError('ENOENT');
    });
    assert.equal(await enabled(f.dataDir, io), false);
    assert.deepEqual(io.calls, [f.current, f.current]);
  });

  test(`${world}: 显式 botDir 是唯一来源，不受两份推测路径影响`, async () => {
    const f = await fixture();
    for (const value of [true, false]) {
      await writeFile(f.current, config(world, !value));
      await writeFile(f.parent, config(world, !value));
      await writeFile(f.authoritative, config(world, value));
      assert.equal(await enabled(f.dataDir, { botDir: f.botDir }), value);
    }
  });

  test(`${world}: 显式权威文件缺失、坏 JSON 或缺段时也不猜其他路径`, async () => {
    const f = await fixture();
    for (const result of ['missing', '{', '{}']) {
      const io = observe(async (path) => {
        if (path !== f.authoritative) return config(world, true);
        if (result === 'missing') throw ioError('ENOENT');
        return result;
      });
      assert.equal(await enabled(f.dataDir, { ...io, botDir: f.botDir }), false);
      assert.ok(io.calls.every((path) => path === f.authoritative));
      assert.equal(io.calls.length, result === '{' ? 2 : 1);
    }
  });

  test(`${world}: 两份配置均缺失时立即 false，不创建文件或等待后台任务`, async () => {
    const f = await fixture();
    const io = observe(async () => { throw ioError('ENOENT'); });
    assert.equal(await enabled(f.dataDir, io), false);
    assert.deepEqual(io.calls, [f.current, f.parent]);
    assert.deepEqual(io.pauses, []);
    assert.equal(await enabled(f.dataDir), false);
  });

  test(`${world}: 不缓存旧 enabled，修改后下一次读取立即生效`, async () => {
    const f = await fixture();
    await writeFile(f.current, config(world, true));
    assert.equal(await enabled(f.dataDir), true);
    await writeFile(f.current, config(world, false));
    assert.equal(await enabled(f.dataDir), false);
  });
}

test('只提取 fun/map 自己的 enabled，不把另一个世界当作能力或版本证明', async () => {
  const f = await fixture();
  await writeFile(f.current, JSON.stringify({ worlds: { fun: { enabled: false }, map: { enabled: true, version: 'future' } } }));
  assert.equal(await readFunEnabled(f.dataDir), false);
  assert.equal(await readMapEnabled(f.dataDir), true);
});

test('无效路径和不在范围内的 World 均安全返回 false', async () => {
  assert.equal(await readFunEnabled(undefined), false);
  assert.equal(await readMapEnabled(null), false);
  assert.equal(await readLinkedWorldEnabled('unused', 'other', { readText: () => assert.fail('不应读取其他 World') }), false);
});

await report();
