import * as FileSystem from "expo-file-system/legacy";
import { PDF_QUALITY } from "./options";
import { runFfmpeg } from "./ffmpeg";
import {
  decodeImage,
  encodeWebp,
  exifOrientation,
  extractH264,
  repairGifTrailer,
  repairJpegEoi,
  repairPdf,
  repairPng,
  repairSniff,
  repairStrip,
  repairZip,
} from "../../modules/honvert-engine";
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
import { EngineError, JobCancelled, keyForFfmpeg, keyForPdf } from "./errors";
import { reencodeTarget, repairExtension, stemOf } from "./names";

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

async function ensureDirs() {
  for (const dir of [OUTPUT_DIR, WORK_DIR]) {
    await FileSystem.makeDirectoryAsync(toUri(dir), { intermediates: true });
  }
}

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

// Repair keeps whatever can still be read from a damaged file. Native code handles bytes (signatures,
// PNG and ZIP structure, PDF cross-references); FFmpeg handles media. A file that cannot be recovered
// reports an error key instead of leaving junk behind.
const REPAIR_MIME = {
  ...MIME,
  jpeg: "image/jpeg",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  aac: "audio/aac",
  opus: "audio/ogg",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
};
const REPAIR_VIDEO = ["mp4", "mov", "mkv", "webm", "avi"];
const REPAIR_AUDIO = ["m4a", "mp3", "wav", "ogg", "flac"];

// Native failures carry a technical reason; the user only sees a translated key.
async function nativeStep(step) {
  try {
    return await step();
  } catch (error) {
    throw new EngineError("error.corrupt", String(error?.message ?? error));
  }
}

// A repair that left nothing readable is a failure: the output is removed and reported as corrupt.
async function requireReadable(path, kind) {
  const info = await probeFile(path).catch(() => null);
  const readable = kind === "image" ? (info?.width ?? 0) > 0 : Boolean(info?.hasVideo || info?.hasAudio);
  if (readable) return;
  await FileSystem.deleteAsync(toUri(path), { idempotent: true }).catch(() => {});
  throw new EngineError("error.corrupt", "nothing readable");
}

async function repairMedia(type, source, output, scratch, progress, reference) {
  // 1. Remux: copy the streams that can still be read. This keeps the quality and is fast.
  const remux = [
    "-y", "-err_detect", "ignore_err", "-fflags", "+genpts+discardcorrupt",
    "-i", source, "-map", "0:v?", "-map", "0:a?", "-c", "copy", output,
  ];
  try {
    await runAttempts([remux], progress);
    await requireReadable(output, "media");
    return output;
  } catch (error) {
    if (error instanceof JobCancelled) throw error;
    if (!REPAIR_VIDEO.includes(type)) throw error;
  }

  // 2. MP4 without its index (moov): rebuild the video stream from the media data, then copy it.
  // The stream does not carry the picture parameters (SPS and PPS), so a reference video supplies them.
  let rawStream = null;
  if (type === "mp4" || type === "mov") {
    const raw = `${scratch}-raw.h264`;
    try {
      await nativeStep(() => extractH264(source, raw, reference?.path ?? null));
      rawStream = raw;
      await runAttempts([["-y", "-f", "h264", "-r", "30", "-i", raw, "-c:v", "copy", output]], progress);
      await requireReadable(output, "media");
      return output;
    } catch (error) {
      if (error instanceof JobCancelled) throw error;
    }
  }

  // 3. Re-encode what can still be decoded. Slow, but it survives damaged packets and bad timestamps.
  const target = reencodeTarget(output);
  const inputArgs = rawStream
    ? ["-f", "h264", "-r", "30", "-i", rawStream]
    : ["-err_detect", "ignore_err", "-fflags", "+genpts+discardcorrupt", "-i", source];
  try {
    await runAttempts(
      [[
        "-y", ...inputArgs,
        "-map", "0:v:0?", "-map", "0:a?",
        "-c:v", "libopenh264", "-b:v", "2M", "-c:a", "aac", "-b:a", "128k",
        target,
      ]],
      progress,
    );
    await requireReadable(target, "media");
    return target;
  } catch (error) {
    if (error instanceof JobCancelled) throw error;
    // An MP4 whose index is gone needs a healthy video from the same camera to recover its picture parameters.
    if (rawStream && !reference) throw new EngineError("error.repairNeedsReference", "no SPS/PPS without a reference");
    throw error;
  }
}

// Repairs one file and returns the path of the recovered output.
async function repairFile(input, index, total, ctx, reference) {
  const found = await nativeStep(() => repairSniff(input.path));
  const extension = repairExtension(found.type, input.name);
  if (!extension) throw new EngineError("error.unsupported", input.name);

  const stem = stemOf(input.name);
  const scratch = `${WORK_DIR}${unique()}`;
  const make = (ext) => `${OUTPUT_DIR}${stem}-repaired-${stamp()}.${ext}`;
  const progress = {
    outputDurationMs: 0,
    onFraction: (fraction) => ctx.report(index + fraction, total),
    control: ctx.control,
  };

  // Junk in front of the header is removed first, so every route below sees a clean file.
  let source = input.path;
  if (found.offset > 0) {
    source = `${scratch}-strip`;
    await nativeStep(() => repairStrip(input.path, source, found.offset));
  }

  if (REPAIR_VIDEO.includes(found.type) || REPAIR_AUDIO.includes(found.type)) {
    return repairMedia(found.type, source, make(extension), scratch, progress, reference);
  }

  switch (found.type) {
    case "jpeg": {
      const fixed = `${scratch}-eoi.jpg`;
      await nativeStep(() => repairJpegEoi(source, fixed));
      const output = make("jpg");
      await runAttempts([["-y", "-err_detect", "ignore_err", "-i", fixed, "-frames:v", "1", output]], progress);
      await requireReadable(output, "image");
      return output;
    }
    case "png": {
      const output = make("png");
      await nativeStep(() => repairPng(source, output));
      await requireReadable(output, "image");
      return output;
    }
    case "gif": {
      const fixed = `${scratch}-trailer.gif`;
      await nativeStep(() => repairGifTrailer(source, fixed));
      const output = make("gif");
      await runAttempts([["-y", "-err_detect", "ignore_err", "-i", fixed, output]], progress);
      await requireReadable(output, "image");
      return output;
    }
    case "webp": {
      const output = make("png");
      await nativeStep(() => decodeImage(source, output));
      await requireReadable(output, "image");
      return output;
    }
    case "pdf": {
      const output = make("pdf");
      await nativeStep(() => repairPdf(source, output));
      return output;
    }
    case "zip": {
      const output = make(extension);
      await nativeStep(() => repairZip(source, output));
      return output;
    }
    default:
      throw new EngineError("error.unsupported", input.name);
  }
}

// Repairs every selected file. Files that recover are returned even when others fail.
async function runRepair(files, options, ctx) {
  const outputs = [];
  let firstError = null;
  for (const [index, input] of files.entries()) {
    try {
      const path = await repairFile(input, index, files.length, ctx, options?.reference ?? null);
      const ext = path.split(".").pop().toLowerCase();
      outputs.push({ path, mime: REPAIR_MIME[ext] ?? "application/octet-stream" });
    } catch (error) {
      if (error instanceof JobCancelled) throw error;
      if (!firstError) firstError = error;
    }
  }
  if (!outputs.length) throw firstError ?? new EngineError("error.corrupt", "no files");
  return { outputs, note: "result.repairPartial" };
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
    case "repair":
      return runRepair(files, options, ctx);
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
