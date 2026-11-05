/**
 * 极小的测试骨架。
 *
 * 为什么不用 node:test / node --test：某些受限沙箱里它要 spawn 子进程，
 * 会被 EPERM 挡住（`自由时间` 那次已经踩过）。这里就是一个计数器加断言。
 *
 * 用法：test('名字', fn) 注册，最后 await report() 跑完并决定退出码。
 */
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export async function report() {
  let passed = 0;
  const failed = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failed.push({ name: t.name, err });
      console.log(`  ✗ ${t.name}`);
      console.log(`      ${err?.message ?? err}`);
    }
  }
  console.log(`\n${passed}/${tests.length} 通过`);
  if (failed.length) process.exitCode = 1;
}
