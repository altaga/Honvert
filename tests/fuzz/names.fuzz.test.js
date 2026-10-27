import { clipBytes, fileNameFor, reencodeTarget, repairExtension, stemOf } from "../../src/engine/names";
import { createRandom, FUZZ_ITERATIONS, FUZZ_SEED, randomText } from "../support/random";

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const UNSAFE_STEM = /[\\/:*?"<>|\u0000-\u001f\s]/;
const UNSAFE_TYPED = /[\\/:*?"<>|\u0000-\u001f]/;
const bytes = (text) => new TextEncoder().encode(text).length;

// Throws with the failing case, so a long run stops at the first bad input and says why.
function ensure(condition, message, context) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(context)}`);
}

describe("fuzz: names", () => {
  it("stemOf always returns a non-empty, safe stem of at most 96 bytes", () => {
    const random = createRandom(FUZZ_SEED);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const name = randomText(random, 60) + (random.bool() ? `.${randomText(random, 6)}` : "");
      const stem = stemOf(name);
      ensure(stem.length > 0, "empty stem", { name });
      ensure(!UNSAFE_STEM.test(stem), "unsafe character in stem", { name, stem });
      ensure(bytes(stem) <= 96, "stem too long", { name, stem });
      if (!LONE_SURROGATE.test(name)) ensure(!LONE_SURROGATE.test(stem), "stem split a character", { name, stem });
    }
  });

  it("stemOf keeps plain ASCII names as they are", () => {
    const random = createRandom(FUZZ_SEED + 1);
    const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const length = random.int(1, 96);
      let stem = "";
      for (let j = 0; j < length; j++) stem += LETTERS[random.int(0, LETTERS.length - 1)];
      ensure(stemOf(`${stem}.mp4`) === stem, "plain name changed", { stem });
    }
  });

  it("clipBytes returns the longest whole-character prefix that fits", () => {
    const random = createRandom(FUZZ_SEED + 2);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const text = randomText(random, 40);
      const max = random.int(0, 120);
      const clipped = clipBytes(text, max);
      ensure(text.startsWith(clipped), "not a prefix", { text, max, clipped });
      ensure(bytes(clipped) <= max, "over the budget", { text, max, clipped });
      const next = [...text.slice(clipped.length)][0];
      if (next !== undefined) ensure(bytes(clipped) + bytes(next) > max, "could have kept more", { text, max, clipped });
    }
  });

  it("fileNameFor always ends with the result's extension and never keeps unsafe characters", () => {
    const random = createRandom(FUZZ_SEED + 3);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const typed = randomText(random, 300);
      const ext = random.pick(["pdf", "mp4", "PNG", "tar", "docx"]);
      const result = fileNameFor(typed, `source.${ext}`);
      ensure(!UNSAFE_TYPED.test(result), "unsafe character kept", { typed, result });
      ensure(result.endsWith(`.${ext}`), "extension missing", { typed, result });
      ensure(bytes(result) <= 200 + 1 + ext.length, "name over the byte budget", { typed, result });
    }
  });

  it("fileNameFor is idempotent: renaming a result to its own name changes nothing", () => {
    const random = createRandom(FUZZ_SEED + 4);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const typed = randomText(random, 120);
      const once = fileNameFor(typed, "source.pdf");
      ensure(fileNameFor(once, "source.pdf") === once, "second pass changed the name", { typed, once });
    }
  });

  it("repairExtension returns a known extension or null", () => {
    const random = createRandom(FUZZ_SEED + 5);
    const TYPES = ["jpeg", "png", "gif", "pdf", "zip", "mkv", "webm", "avi", "wav", "mp4", "mov", "m4a", "ogg", "flac", "mp3", "unknown"];
    const OFFICE = ["docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "zip"];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const type = random.pick(TYPES);
      const name = randomText(random, 20) + random.pick(["", ".DOCX", ".zip", ".jpeg", ".xlsx", ".bin"]);
      const result = repairExtension(type, name);
      if (type === "unknown") ensure(result === null, "unknown type must not get an extension", { type, name, result });
      else if (type === "zip") ensure(OFFICE.includes(result), "zip gets an unknown extension", { name, result });
      else ensure(typeof result === "string" && result.length > 0, "no extension", { type, name, result });
    }
  });

  it("reencodeTarget keeps the folder, is idempotent, and only ever targets MP4 or its own container", () => {
    const random = createRandom(FUZZ_SEED + 6);
    const FOLDERS = ["/data/converted", "/data.v2/out", "/storage/中文 文件", "/a", "/x.y.z/w"];
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const folder = random.pick(FOLDERS);
      const base = `clip${random.int(0, 9999)}`;
      const ext = random.pick(["", ".mp4", ".MOV", ".mkv", ".avi", ".webm", ".MP4x"]);
      const output = `${folder}/${base}${ext}`;
      const result = reencodeTarget(output);
      ensure(result.startsWith(`${folder}/`), "folder changed", { output, result });
      ensure(reencodeTarget(result) === result, "not idempotent", { output, result });
      const keeps = ["mp4", "mov", "mkv"].includes(ext.slice(1).toLowerCase());
      ensure(keeps ? result === output : result === `${folder}/${base}.mp4`, "wrong target", { output, result });
    }
  });
});
