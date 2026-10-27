import { buildAudioArgs, buildGifArgs, buildImageArgs, buildVideoArgs, cropFilter, RATIOS } from "../../src/engine/media";
import { createRandom, FUZZ_ITERATIONS, FUZZ_SEED } from "../support/random";

jest.mock("../../modules/honvert-engine", () => ({ probe: jest.fn(), getEncoders: jest.fn() }));

const RATIO_KEYS = Object.keys(RATIOS);
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

// Throws with the failing case, so a long run stops at the first bad input and says why.
function ensure(condition, message, context) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(context)}`);
}

// No command may contain a leaked undefined, null, NaN or Infinity, and every argument must be a string.
function ensureClean(args, context) {
  for (const arg of args) {
    ensure(typeof arg === "string", "non-string argument", { arg, context });
    ensure(!/undefined|null|NaN|Infinity/.test(arg), "leaked value in argument", { arg, args, context });
  }
}

describe("fuzz: media builders", () => {
  it("cropFilter gives even, centered, in-bounds crops that keep the ratio", () => {
    const random = createRandom(FUZZ_SEED);
    let crops = 0;
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const width = random.int(1, 4096);
      const height = random.int(1, 4096);
      const ratio = random.pick(RATIO_KEYS);
      const crop = cropFilter(ratio, width, height);
      if (crop === null) continue;
      crops++;
      const context = { width, height, ratio, crop };
      const match = /^crop=(\d+):(\d+):(\d+):(\d+)$/.exec(crop);
      ensure(match !== null, "malformed crop", context);
      const [cw, ch, x, y] = match.slice(1).map(Number);
      ensure(cw % 2 === 0 && ch % 2 === 0, "odd crop size", context);
      ensure(cw >= 2 && ch >= 2, "empty crop", context);
      ensure(cw <= width && ch <= height, "crop larger than the picture", context);
      ensure(x === Math.floor((width - cw) / 2) && y === Math.floor((height - ch) / 2), "crop not centered", context);
      const [rw, rh] = RATIOS[ratio];
      const target = rw / rh;
      ensure(Math.abs(cw / ch - target) <= (2 + target) / Math.min(cw, ch), "ratio drifted", context);
    }
    ensure(crops > FUZZ_ITERATIONS / 4, "too few crops to mean anything", { crops });
  });

  it("image arguments stay valid, keep the output last, and flatten only when the size is known", () => {
    const random = createRandom(FUZZ_SEED + 1);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const format = random.pick(["jpg", "png", "bmp"]);
      const width = random.bool() ? random.int(2, 4096) : undefined;
      const height = width !== undefined && random.bool() ? random.int(2, 4096) : undefined;
      const context = {
        format,
        quality: random.int(1, 100),
        scalePercent: random.int(1, 100),
        ratio: random.pick(RATIO_KEYS),
        width,
        height,
      };
      const args = buildImageArgs({ input: "in.src", output: "out.dst", ...context });
      ensureClean(args, context);
      ensure(args.at(-1) === "out.dst", "output is not last", { args, context });
      ensure(valueAfter(args, "-frames:v") === "1", "missing single-frame flag", { args, context });
      const flattens = (format === "jpg" || format === "bmp") && width !== undefined && height !== undefined;
      ensure(args.includes("-filter_complex") === flattens, "flatten rule broken", { args, context });
      if (format === "jpg") {
        const qscale = Number(valueAfter(args, "-q:v"));
        ensure(qscale >= 2 && qscale <= 31, "qscale out of range", { qscale, context });
      }
    }
  });

  it("JPEG quality only ever moves one way", () => {
    const random = createRandom(FUZZ_SEED + 2);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a = random.int(1, 100);
      const b = random.int(1, 100);
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const qLow = Number(valueAfter(buildImageArgs({ input: "a", output: "b.jpg", format: "jpg", quality: low }), "-q:v"));
      const qHigh = Number(valueAfter(buildImageArgs({ input: "a", output: "b.jpg", format: "jpg", quality: high }), "-q:v"));
      ensure(qHigh <= qLow, "higher quality got a worse qscale", { low, high, qLow, qHigh });
    }
  });

  it("GIF graphs keep the loop, and add each filter only when its option asks for it", () => {
    const random = createRandom(FUZZ_SEED + 3);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const context = {
        fps: random.pick([10, 15, 24, random.int(1, 60)]),
        width: random.int(2, 4096),
        speed: random.pick([0.5, 0.75, 1, 1.25, 1.5, 2]),
        ratio: random.pick(RATIO_KEYS),
        inputWidth: random.int(2, 4096),
        inputHeight: random.int(2, 4096),
        still: random.bool(),
      };
      const args = buildGifArgs({ input: "in.src", output: "out.gif", ...context });
      ensureClean(args, context);
      ensure(args.at(-1) === "out.gif", "output is not last", { args, context });
      ensure(args.slice(-4, -1).join(" ") === "-an -loop 0", "loop or audio flags missing", { args, context });
      const graph = valueAfter(args, "-filter_complex");
      ensure(graph.includes("fps=") === !context.still, "fps filter rule broken", { graph, context });
      ensure(graph.includes(`setpts=PTS/${context.speed}`) === (context.speed !== 1), "speed filter rule broken", { graph, context });
      ensure(graph.includes(`scale='min(iw\\,${context.width})':-2`), "scale filter missing", { graph, context });
    }
  });

  it("audio arguments map each format, and change tempo only when the speed differs", () => {
    const random = createRandom(FUZZ_SEED + 4);
    const CODEC = { mp3: "libmp3lame", m4a: "aac", ogg: "libopus", wav: "pcm_s16le", flac: "flac" };
    const FORMATS = Object.keys(CODEC);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const context = {
        format: random.pick(FORMATS),
        bitrate: random.int(32, 320),
        speed: random.pick([0.5, 0.75, 1, 1.25, 1.5, 2]),
      };
      const args = buildAudioArgs({ input: "in.src", output: "out.dst", ...context });
      ensureClean(args, context);
      ensure(args.at(-1) === "out.dst" && args.includes("-vn"), "output or video-off flag missing", { args, context });
      ensure(valueAfter(args, "-c:a") === CODEC[context.format], "wrong codec", { args, context });
      const hasBitrate = ["mp3", "m4a", "ogg"].includes(context.format);
      ensure(args.includes(`${context.bitrate}k`) === hasBitrate, "bitrate rule broken", { args, context });
      ensure(args.includes("-af") === (context.speed !== 1), "tempo rule broken", { args, context });
    }
  });

  it("video arguments pick the right encoder and the right audio, faststart and scale flags", () => {
    const random = createRandom(FUZZ_SEED + 5);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const context = {
        format: random.pick(["mp4", "webm"]),
        height: random.pick([0, 240, 360, 480, 720, 1080, random.int(2, 2160)]),
        bitrate: random.int(100, 20000),
        speed: random.pick([0.5, 1, 1.25, 2]),
        ratio: random.pick(RATIO_KEYS),
        inputWidth: random.int(2, 4096),
        inputHeight: random.int(2, 4096),
        keepAudio: random.bool(),
        hardware: random.bool(),
      };
      const args = buildVideoArgs({ input: "in.src", output: "out.dst", ...context });
      ensureClean(args, context);
      ensure(args.at(-1) === "out.dst", "output is not last", { args, context });
      const expected = context.format === "webm" ? "libvpx" : context.hardware ? "h264_mediacodec" : "libopenh264";
      ensure(valueAfter(args, "-c:v") === expected, "encoder rule broken", { args, context });
      ensure(args.includes("-an") === !context.keepAudio, "audio rule broken", { args, context });
      ensure(args.includes("+faststart") === (context.format === "mp4"), "faststart rule broken", { args, context });
      const filters = valueAfter(args, "-vf");
      ensure(filters.endsWith("format=yuv420p"), "pixel format must come last", { filters, context });
      ensure(filters.includes("scale=-2:min(ih\\,") === (context.height > 0), "height rule broken", { filters, context });
      ensure(filters.includes(`setpts=PTS/${context.speed}`) === (context.speed !== 1), "speed rule broken", { filters, context });
    }
  });
});
