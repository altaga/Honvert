import { initialRect, MIN_SIZE, moveRect, normalizedAspect, rectFilter, resizeRect } from "../../src/engine/crop";
import { RATIOS } from "../../src/engine/ratios";
import { createRandom, FUZZ_ITERATIONS, FUZZ_SEED } from "../support/random";

const RATIO_KEYS = Object.keys(RATIOS);
const CORNERS = ["tl", "tr", "bl", "br"];
const EPSILON = 1e-9;

function ensure(condition, message, context) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(context)}`);
}

function ensureInside(rect, context) {
  ensure(Object.values(rect).every(Number.isFinite), "non-finite rect", { rect, context });
  ensure(rect.x >= -EPSILON && rect.y >= -EPSILON, "box starts outside", { rect, context });
  ensure(rect.x + rect.w <= 1 + EPSILON && rect.y + rect.h <= 1 + EPSILON, "box ends outside", { rect, context });
  ensure(rect.w > 0 && rect.h > 0, "empty box", { rect, context });
}

describe("fuzz: crop box", () => {
  it("any sequence of drags keeps the box inside the picture, with its shape", () => {
    const random = createRandom(FUZZ_SEED);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const width = random.int(2, 8000);
      const height = random.int(2, 8000);
      const ratio = random.pick(RATIO_KEYS);
      const aspect = normalizedAspect(ratio, width, height);
      let rect = initialRect(ratio, width, height);
      const context = { i, width, height, ratio };
      ensureInside(rect, context);

      for (let step = 0; step < 6; step++) {
        const dx = (random.next() - 0.5) * 2.4;
        const dy = (random.next() - 0.5) * 2.4;
        rect = random.bool() ? moveRect(rect, dx, dy) : resizeRect(rect, random.pick(CORNERS), dx, dy, aspect);
        ensureInside(rect, { ...context, step, dx, dy });
        // The minimum only gives way when the picture's shape leaves no room for it.
        if (!aspect) ensure(rect.w >= MIN_SIZE - EPSILON && rect.h >= MIN_SIZE - EPSILON, "box collapsed", { rect, context });
        if (aspect) ensure(Math.abs(rect.w / rect.h - aspect) < 1e-6 * aspect, "shape lost", { rect, aspect, context });
      }

      const filter = rectFilter(rect, width, height);
      if (filter) {
        const [w, h, x, y] = filter.slice(5).split(":").map(Number);
        ensure(w % 2 === 0 && h % 2 === 0 && w >= 2 && h >= 2, "odd or empty crop", { filter, context });
        ensure(x >= 0 && y >= 0 && x + w <= width && y + h <= height, "crop outside the picture", { filter, context });
      }
    }
  });
});
