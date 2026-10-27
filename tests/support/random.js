// Seeded randomness for the fuzz tests. The same seed replays the same cases, so any failure can be reproduced.
export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    // mulberry32: small, fast, and good enough for generating test inputs.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    bool: () => next() < 0.5,
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

// Cases per fuzz property. `npm test` keeps it small; `npm run test:deep` raises it to a million.
export const FUZZ_ITERATIONS = Number(process.env.HONVERT_FUZZ_ITERATIONS) || 20000;
export const FUZZ_SEED = Number(process.env.HONVERT_FUZZ_SEED) || 20261027;

// Characters that stress names and paths: separators, reserved punctuation, control characters, whitespace,
// several scripts, emoji, combining marks, bidi controls, and lone surrogates (invalid UTF-16 that can still
// reach a JavaScript string).
const TEXT_POOL = [
  "a", "B", "z", "0", "9", " ", "_", "-", ".", ",", "(", ")", "/", "\\", ":", "*", "?", '"', "<", ">", "|",
  "\t", "\n", "\u0000", "\u001f", "\u007f", "é", "ñ", "ß", "Ж", "中", "か", "ا", "ह", "🎬", "📄", "‍",
  "́", "‮", "\ud800", "\udc00",
];

export function randomText(random, maxLength) {
  const length = random.int(0, maxLength);
  let text = "";
  for (let i = 0; i < length; i++) text += random.pick(TEXT_POOL);
  return text;
}
