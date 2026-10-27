import { interpolate } from "../../src/i18n/index";
import { createRandom, FUZZ_ITERATIONS, FUZZ_SEED, randomText } from "../support/random";

jest.mock("../../src/utilsApp/utils", () => ({ getAsyncStorageValue: jest.fn(), setAsyncStorageValue: jest.fn() }));
jest.mock("../../src/core/prefs", () => ({ loadPrefs: jest.fn(), prefs: { haptics: true }, setHaptics: jest.fn() }));

const NAMES = ["count", "name", "folder", "x", "y"];

// Throws with the failing case, so a long run stops at the first bad input and says why.
function ensure(condition, message, context) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(context)}`);
}

describe("fuzz: interpolate", () => {
  it("fills every provided name, keeps every missing one, and never throws", () => {
    const random = createRandom(FUZZ_SEED + 6);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const params = {};
      for (const name of NAMES) if (random.bool()) params[name] = randomText(random, 8);
      const used = NAMES.filter(() => random.bool());
      const template = `${used.map((name) => `[{${name}}]`).join(" ")} tail`;
      const result = interpolate(template, params);
      for (const name of NAMES) {
        const placeholder = `{${name}}`;
        if (name in params) ensure(!result.includes(placeholder), "placeholder left behind", { template, params, result });
        else if (used.includes(name)) ensure(result.includes(placeholder), "missing name was dropped", { template, params, result });
      }
    }
  });
});
