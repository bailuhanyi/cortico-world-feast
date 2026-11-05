/**
 * 确定性伪随机：由一个字符串播种。
 *
 * 「这一口」和「这一桌」都要用同一个种子算法——同一道菜连着吃两次说的话不一样，
 * 但同一个种子重放又必须稳定（测试锁着这一条）。放在这里，两边共用一份实现。
 */

/** 字符串 → 32 位整数种子（FNV-1a）。 */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：小而够用的确定性伪随机。 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由字符串直接拿一个 rng。 */
export function rngFrom(str) {
  return makeRng(hashSeed(String(str)));
}
