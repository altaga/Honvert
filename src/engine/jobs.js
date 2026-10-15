import * as FileSystem from "expo-file-system/legacy";
import { PDF_QUALITY } from "./options";
import { runFfmpeg } from "./ffmpeg";
import { decodeImage, encodeWebp, exifOrientation } from "../../modules/honvert-engine";
import {
  FFMPEG_IMAGE_CODECS,
  buildAudioArgs,
  buildGifArgs,
  buildImageArgs,
  buildVideoArgs,
  hasHardwareH264,
  probeFile,
} from "./media";
import { compressPdf, mergePdfs, pdfFromJpegs, pdfToImages, splitPdf, writeBytes } from "./pdf";

export const toPath = (uri) => decodeURIComponent(uri.replace(/^file:\/\//, ""));
const toUri = (path) => `file://${path}`;

const documentDir = toPath(FileSystem.documentDirectory);
const cacheDir = toPath(FileSystem.cacheDirectory);

export const OUTPUT_DIR = `${documentDir}converted/`;
export const WORK_DIR = `${cacheDir}honvert-work/`;

export const MIME = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};

// Errors carry a translation key. The UI shows the translated text; `detail` stays technical.
export class EngineError extends Error {
  constructor(key, detail = "") {
    super(key);
    this.name = "EngineError";
    this.key = key;
    this.detail = detail;
  }
}

export class JobCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "JobCancelled";
  }
}

// Turns raw FFmpeg output into a friendly key.
function keyForFfmpeg(output = "") {
  if (/Unknown encoder|Unknown decoder|Encoder .* not found|No such filter|not found/i.test(output)) {
    return "error.unsupported";
  }
  if (/Invalid data|Invalid argument|does not contain any stream|moov atom not found|could not find codec/i.test(output)) {
    return "error.corrupt";
  }
  return "error.generic";
}

export function keyForPdf(error) {
  const text = String(error?.message ?? error ?? "");
  if (/password|encrypt/i.test(text)) return "error.pdfEncrypted";
  return "error.pdfInvalid";
}

async function ensureDirs() {
  for (const dir of [OUTPUT_DIR, WORK_DIR]) {
    await FileSystem.makeDirectoryAsync(toUri(dir), { intermediates: true });
  }
}

// Keeps the name readable (any script) and safe for the file system.
const stemOf = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 48) || "file";
const stamp = () => Date.now().toString(36);
let counter = 0;
const unique = () => `${stamp()}${(counter++).toString(36)}`;

// A cancelled or failed run must not leave a half-written file behind. Every builder puts the output last.
async function removePartialOutput(args) {
  const output = args[args.length - 1];
  await FileSystem.deleteAsync(toUri(output), { idempotent: true }).catch(() => {});
}

// Runs the first attempt; if it fails, moves on to the next one (for example GPU, then CPU).
async function runAttempts(attempts, { outputDurationMs, onFraction, control }) {
  let lastOutput = "";
  for (let index = 0; index < attempts.length; index++) {
    if (control.cancelled) throw new JobCancelled();

    const job = runFfmpeg(attempts[index], { outputDurationMs, onFraction });
    control.cancelCurrent = job.cancel;
    const result = await job.done;
    control.cancelCurrent = null;

    if (result.cancelled) {
      await removePartialOutput(attempts[index]);
      throw new JobCancelled();
    }
    if (result.success) {
      // Every builder puts the output path last. FFmpeg can report success with an empty file, so check it.
      const output = attempts[index][attempts[index].length - 1];
      const stat = await FileSystem.getInfoAsync(toUri(output));
      if (!stat.exists || !stat.size) throw new EngineError("error.corrupt", "empty output");
      return { usedFallback: index > 0 };
    }
    await removePartialOutput(attempts[index]);
    lastOutput = result.output;
  }
  throw new EngineError(keyForFfmpeg(lastOutput), lastOutput.slice(-600));
}

// Images FFmpeg cannot decode (WEBP, HEIC, ...) are first decoded by Android into a PNG.
async function prepareImage(file, control) {
  if (control.cancelled) throw new JobCancelled();

  const info = await probeFile(file.path).catch(() => ({ width: 0, codec: "" }));
  const rotated = exifOrientation(file.path) > 1;
  if (info.width && FFMPEG_IMAGE_CODECS.has(info.codec) && !rotated) {
    return { path: file.path, info };
  }

  const decoded = `${WORK_DIR}decoded-${unique()}.png`;
  try {
    await decodeImage(file.path, decoded);
  } catch (error) {
    throw new EngineError("error.unreadableImage", String(error?.message ?? error));
  }
  const decodedInfo = await probeFile(decoded);
  if (!decodedInfo.width) throw new EngineError("error.unreadableImage");
  return { path: decoded, info: decodedInfo };
}

async function runImage(files, options, ctx) {
  const input = files[0];
  const prepared = await prepareImage(input, ctx.control);
  const output = `${OUTPUT_DIR}${stemOf(input.name)}-honvert-${stamp()}.${options.format}`;
  const shared = {
    input: prepared.path,
    scalePercent: options.scalePercent,
    ratio: options.ratio,
    width: prepared.info.width,
    height: prepared.info.height,
  };

  if (options.format === "webp") {
    // The FFmpeg build has no WebP encoder: crop and scale to a temporary PNG, then encode with Android.
    const intermediate = `${WORK_DIR}${unique()}.png`;
    await runAttempts([buildImageArgs({ ...shared, output: intermediate, format: "png" })], {
      onFraction: ctx.fraction(0, 2),
      control: ctx.control,
    });
    ctx.report(1, 2);
    await encodeWebp(intermediate, output, options.quality);
    return { outputs: [{ path: output, mime: MIME.webp }], note: null };
  }

  await runAttempts(
    [buildImageArgs({ ...shared, output, format: options.format, quality: options.quality })],
    { onFraction: ctx.fraction(0, 1), control: ctx.control },
  );
  return { outputs: [{ path: output, mime: MIME[options.format] }], note: null };
}

async function runGif(files, options, ctx) {
  const input = files[0];
  let source = input.path;
  let info = await probeFile(input.path).catch(() => ({ hasVideo: false, durationMs: 0, width: 0, height: 0 }));
  let still = false;

  if (!info.hasVideo) {
    // A still or an animated format FFmpeg cannot read: use its first frame as a one-frame GIF.
    const prepared = await prepareImage(input, ctx.control).catch(() => {
      throw new EngineError("error.noVisual");
    });
    source = prepared.path;
    info = prepared.info;
    still = true;
  } else if (!info.durationMs) {
    still = true;
  }

  const output = `${OUTPUT_DIR}${stemOf(input.name)}-honvert-${stamp()}.gif`;
  await runAttempts(
    [
      buildGifArgs({
        input: source,
        output,
        fps: options.fps,
        width: options.width,
        speed: options.speed,
        ratio: options.ratio,
        inputWidth: info.width,
        inputHeight: info.height,
        still,
      }),
    ],
    { outputDurationMs: info.durationMs / options.speed, onFraction: ctx.fraction(0, 1), control: ctx.control },
  );
  return { outputs: [{ path: output, mime: MIME.gif }], note: null };
}

async function runAudio(files, options, ctx) {
  const input = files[0];
  const info = await probeFile(input.path).catch(() => ({ hasAudio: false, durationMs: 0 }));
  if (!info.hasAudio) throw new EngineError("error.noAudio");

  const output = `${OUTPUT_DIR}${stemOf(input.name)}-honvert-${stamp()}.${options.format}`;
  await runAttempts(
    [
      buildAudioArgs({
        input: input.path,
        output,
        format: options.format,
        bitrate: options.bitrate,
        speed: options.speed,
      }),
    ],
    { outputDurationMs: info.durationMs / options.speed, onFraction: ctx.fraction(0, 1), control: ctx.control },
  );
  return { outputs: [{ path: output, mime: MIME[options.format] }], note: null };
}

async function runVideo(files, options, ctx) {
  const input = files[0];
  const info = await probeFile(input.path).catch(() => ({ hasVideo: false, durationMs: 0, width: 0, height: 0 }));
  if (!info.hasVideo) throw new EngineError("error.noVideo");

  const output = `${OUTPUT_DIR}${stemOf(input.name)}-honvert-${stamp()}.${options.format}`;
  const base = {
    input: input.path,
    output,
    format: options.format,
    height: options.height,
    bitrate: options.bitrate,
    speed: options.speed,
    ratio: options.ratio,
    inputWidth: info.width,
    inputHeight: info.height,
    keepAudio: options.keepAudio,
  };

  // GPU (MediaCodec) first when the phone has a hardware H.264 encoder; CPU if it fails.
  const useGpu = options.format === "mp4" && options.gpu && hasHardwareH264();
  const attempts = useGpu
    ? [buildVideoArgs({ ...base, hardware: true }), buildVideoArgs({ ...base, hardware: false })]
    : [buildVideoArgs({ ...base, hardware: false })];

  const { usedFallback } = await runAttempts(attempts, {
    outputDurationMs: info.durationMs / options.speed,
    onFraction: ctx.fraction(0, 1),
    control: ctx.control,
  });

  let note = null;
  if (useGpu) note = usedFallback ? "result.gpuFallback" : "result.gpuUsed";
  return { outputs: [{ path: output, mime: MIME[options.format] }], note };
}

async function runPdf(files, options, ctx) {
  const quality = PDF_QUALITY[options.quality];
  const stem = stemOf(files[0].name);

  try {
    if (options.mode === "images-to-pdf") {
      const steps = files.length + 1;
      const entries = [];
      for (let index = 0; index < files.length; index++) {
        const prepared = await prepareImage(files[index], ctx.control);
        const tmp = `${WORK_DIR}img-${unique()}.jpg`;
        await runAttempts(
          [buildImageArgs({ input: prepared.path, output: tmp, format: "jpg", quality: quality.jpegQuality, width: prepared.info.width, height: prepared.info.height })],
          { onFraction: ctx.fraction(index, steps), control: ctx.control },
        );
        const info = await probeFile(tmp);
        entries.push({ path: tmp, width: info.width, height: info.height });
      }
      ctx.report(files.length, steps);
      const output = `${OUTPUT_DIR}${stem}-honvert-${stamp()}.pdf`;
      await writeBytes(output, await pdfFromJpegs(entries));
      return { outputs: [{ path: output, mime: MIME.pdf }], note: null };
    }

    if (options.mode === "merge") {
      ctx.report(0, 2);
      const output = `${OUTPUT_DIR}${stem}-union-${stamp()}.pdf`;
      await writeBytes(output, await mergePdfs(files.map((file) => file.path)));
      ctx.report(2, 2);
      return { outputs: [{ path: output, mime: MIME.pdf }], note: null };
    }

    if (options.mode === "split") {
      const parts = await splitPdf(files[0].path);
      const outputs = [];
      for (const part of parts) {
        const output = `${OUTPUT_DIR}${stem}-p${part.pageNumber}-${stamp()}.pdf`;
        await writeBytes(output, part.bytes);
        outputs.push({ path: output, mime: MIME.pdf });
        ctx.report(part.pageNumber, parts.length);
      }
      return { outputs, note: null };
    }

    if (options.mode === "to-images") {
      const outputs = await pdfToImages(files[0].path, {
        dpi: quality.dpi,
        format: options.format,
        quality: quality.jpegQuality,
        outputDir: OUTPUT_DIR,
        stem: `${stem}-${stamp()}`,
        onPage: (page, total) => ctx.report(page, total),
      });
      return { outputs: outputs.map((path) => ({ path, mime: MIME[options.format] })), note: null };
    }

    if (options.mode === "compress") {
      const bytes = await compressPdf(files[0].path, {
        dpi: quality.dpi,
        quality: quality.jpegQuality,
        workDir: WORK_DIR,
        onPage: (page, total) => ctx.report(page, total),
      });
      const output = `${OUTPUT_DIR}${stem}-comprimido-${stamp()}.pdf`;
      await writeBytes(output, bytes);
      return { outputs: [{ path: output, mime: MIME.pdf }], note: "result.pdfRaster" };
    }
  } catch (error) {
    if (error instanceof EngineError || error instanceof JobCancelled) throw error;
    throw new EngineError(keyForPdf(error), String(error?.message ?? error));
  }

  throw new EngineError("error.unknownMode");
}

// Runs one conversion. Returns { outputs: [{ path, mime }], note: translationKey | null }.
export async function runConversion(category, files, options, { onProgress, control }) {
  await ensureDirs();

  const ctx = {
    control,
    fraction: (step, steps) => (fraction) => onProgress?.((step + fraction) / steps),
    report: (done, total) => onProgress?.(total ? done / total : 0),
  };

  switch (category) {
    case "image":
      return runImage(files, options, ctx);
    case "gif":
      return runGif(files, options, ctx);
    case "audio":
      return runAudio(files, options, ctx);
    case "video":
      return runVideo(files, options, ctx);
    case "pdf":
      return runPdf(files, options, ctx);
    default:
      throw new EngineError("error.unknownMode");
  }
}

export function newControl() {
  return { cancelled: false, cancelCurrent: null };
}

export function cancelControl(control) {
  control.cancelled = true;
  control.cancelCurrent?.();
}

export const fileUri = (path) => toUri(path);
