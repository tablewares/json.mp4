/**
 * prng.mjs — seeded PRNG (mulberry32) + small helpers shared by
 * scripts/curate generators. Same generator as scene-quota.mjs; a given
 * --seed reproduces byte-identical output across tools that use it.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wraps one mulberry32 instance with the randInt/pick/chance helpers every
// generator in this directory reaches for, so callers get one rnd() plus
// three derived helpers off a single seed instead of re-deriving them.
export function createRng(seed) {
  const rnd = mulberry32(seed);
  return {
    rnd,
    randInt(min, max) {
      return Math.floor(rnd() * (max - min + 1)) + min;
    },
    pick(arr) {
      return arr[Math.floor(rnd() * arr.length)];
    },
    chance(p) {
      return rnd() < p;
    },
  };
}
