import { CATEGORIES } from "../../src/engine/options";
import { buildAudioArgs, buildGifArgs, buildImageArgs, buildVideoArgs } from "../../src/engine/media";

jest.mock("../../modules/honvert-engine", () => ({ probe: jest.fn(), getEncoders: jest.fn() }));

// Every choice a user can pick must produce a valid FFmpeg command, not only the defaults.
const BUILDERS = {
  image: (options) => buildImageArgs({ input: "in.src", output: "out.dst", width: 1920, height: 1080, ...options }),
  gif: (options) => buildGifArgs({ input: "in.src", output: "out.dst", inputWidth: 1920, inputHeight: 1080, ...options }),
  audio: (options) => buildAudioArgs({ input: "in.src", output: "out.dst", ...options }),
  video: ({ gpu, ...options }) =>
    buildVideoArgs({ input: "in.src", output: "out.dst", inputWidth: 1920, inputHeight: 1080, hardware: gpu, ...options }),
};

describe.each(Object.keys(BUILDERS))("%s options", (category) => {
  const config = CATEGORIES[category];
  const controls = config.controls.filter((control) => control.choices);

  it.each(controls.map((control) => [control.key]))("%s: every choice builds a valid command", (key) => {
    const control = controls.find((item) => item.key === key);
    for (const choice of control.choices) {
      // WEBP is encoded natively, so it never reaches the FFmpeg builders.
      if (key === "format" && choice.value === "webp") continue;
      const args = BUILDERS[category]({ ...config.defaults, [key]: choice.value });
      expect(args.every((arg) => typeof arg === "string" && !/undefined|null|NaN|Infinity/.test(arg))).toBe(true);
      expect(args.at(-1)).toBe("out.dst");
    }
  });

  it("builds a valid command from its defaults", () => {
    const args = BUILDERS[category]({ ...config.defaults });
    expect(args.at(-1)).toBe("out.dst");
  });
});
