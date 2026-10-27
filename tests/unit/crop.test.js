import { initialRect, MIN_SIZE, moveRect, normalizedAspect, rectFilter, resizeRect } from "../../src/engine/crop";

const close = (a, b) => Math.abs(a - b) < 1e-9;

describe("normalizedAspect", () => {
  it("is null for original, free, and unknown sizes", () => {
    expect(normalizedAspect("original", 1920, 1080)).toBeNull();
    expect(normalizedAspect("free", 1920, 1080)).toBeNull();
    expect(normalizedAspect("1:1", 0, 1080)).toBeNull();
  });

  it("turns a pixel ratio into a ratio of the picture", () => {
    // A square on a 16:9 picture covers 9/16 of the width for the full height.
    expect(normalizedAspect("1:1", 1920, 1080)).toBeCloseTo(1080 / 1920);
    expect(normalizedAspect("16:9", 1920, 1080)).toBeCloseTo(1);
  });
});

describe("initialRect", () => {
  it("covers the whole picture for a free box", () => {
    expect(initialRect("free", 1920, 1080)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("is the largest centered box with the preset's shape", () => {
    const rect = initialRect("1:1", 1920, 1080);
    expect(rect.h).toBe(1);
    expect(rect.w).toBeCloseTo(0.5625);
    expect(rect.x).toBeCloseTo((1 - 0.5625) / 2);
    expect(rect.w * 1920).toBeCloseTo(rect.h * 1080);
  });

  it("fits a wide preset on a tall picture", () => {
    const rect = initialRect("16:9", 1080, 1920);
    expect(rect.w).toBe(1);
    expect((rect.w * 1080) / (rect.h * 1920)).toBeCloseTo(16 / 9);
  });
});

describe("moveRect", () => {
  it("moves the box and stops at the edges", () => {
    const rect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(moveRect(rect, 0.1, 0.1)).toEqual({ x: 0.30000000000000004, y: 0.30000000000000004, w: 0.5, h: 0.5 });
    expect(moveRect(rect, 1, 1)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(moveRect(rect, -1, -1)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });
});

describe("resizeRect", () => {
  const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it("keeps the opposite corner in place", () => {
    const grown = resizeRect(rect, "br", 0.1, 0.1);
    expect(grown.x).toBe(0.25);
    expect(grown.y).toBe(0.25);
    expect(close(grown.w, 0.6)).toBe(true);

    const fromTopLeft = resizeRect(rect, "tl", -0.1, -0.1);
    expect(close(fromTopLeft.x + fromTopLeft.w, 0.75)).toBe(true);
    expect(close(fromTopLeft.y + fromTopLeft.h, 0.75)).toBe(true);
  });

  it("never shrinks below the minimum size or leaves the picture", () => {
    const tiny = resizeRect(rect, "br", -1, -1);
    expect(tiny.w).toBe(MIN_SIZE);
    expect(tiny.h).toBe(MIN_SIZE);
    const huge = resizeRect(rect, "tr", 5, -5);
    expect(huge.x).toBe(0.25);
    expect(close(huge.x + huge.w, 1)).toBe(true);
    expect(huge.y).toBe(0);
  });

  it("keeps a preset's shape", () => {
    const resized = resizeRect(rect, "br", 0.2, 0, 1);
    expect(close(resized.w, resized.h)).toBe(true);
  });
});

describe("rectFilter", () => {
  it("is null for the whole picture, an empty box or no size", () => {
    expect(rectFilter({ x: 0, y: 0, w: 1, h: 1 }, 1920, 1080)).toBeNull();
    expect(rectFilter({ x: 0, y: 0, w: 0, h: 0 }, 1920, 1080)).toBeNull();
    expect(rectFilter({ x: 0, y: 0, w: 0.5, h: 0.5 }, 0, 0)).toBeNull();
    expect(rectFilter(null, 1920, 1080)).toBeNull();
  });

  it("gives an even crop in pixels", () => {
    expect(rectFilter({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1920, 1080)).toBe("crop=960:540:480:270");
    expect(rectFilter({ x: 0.1, y: 0.1, w: 0.333, h: 0.333 }, 101, 101)).toBe("crop=34:34:10:10");
  });
});
