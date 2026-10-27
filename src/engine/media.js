import { getEncoders, probe } from "../../modules/honvert-engine";

// Ratio presets. "original" means no crop.
export const RATIOS = {
  original: null,
  "1:1": [1, 1],
  "4:3": [4, 3],
  "16:9": [16, 9],
  "9:16": [9, 16],
};

// Codecs FFmpeg decodes natively in this build. Anything else (WEBP, HEIC, AVIF...) goes through Android.
export const FFMPEG_IMAGE_CODECS = new Set(["mjpeg", "png", "bmp", "gif", "tiff", "jpeg2000"]);

// Rotation in degrees (0, 90, 180, 270) from a stream's display matrix or rotate tag.
function rotationOf(stream) {
  const fromSide = (stream.side_data_list ?? []).find((data) => data.rotation !== undefined)?.rotation;
  const fromTag = Number(stream.tags?.rotate);
  const degrees = fromSide ?? (Number.isFinite(fromTag) ? fromTag : 0);
  return ((Math.round(degrees) % 360) + 360) % 360;
}

export async function probeFile(path) {
  const info = JSON.parse(await probe(path));
  const streams = info.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const seconds = Number(info.format?.duration ?? video?.duration ?? audio?.duration ?? 0);

  // Phone photos and videos store their orientation as metadata. FFmpeg auto-rotates the frames,
  // so crop math must use the rotated size.
  let width = video?.width ?? 0;
  let height = video?.height ?? 0;
  if (video && [90, 270].includes(rotationOf(video))) {
    [width, height] = [height, width];
  }

  return {
    durationMs: Number.isFinite(seconds) ? seconds * 1000 : 0,
    width,
    height,
    codec: video?.codec_name ?? "",
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

// Center crop to a ratio, with even dimensions so H.264 and VP8 accept the output.
export function cropFilter(ratioKey, width, height) {
  const ratio = RATIOS[ratioKey];
  if (!ratio || !width || !height) return null;

  const target = ratio[0] / ratio[1];
  let cropWidth;
  let cropHeight;
  if (width / height > target) {
    cropHeight = height;
    cropWidth = Math.round(height * target);
  } else {
    cropWidth = width;
    cropHeight = Math.round(width / target);
  }
  cropWidth -= cropWidth % 2;
  cropHeight -= cropHeight % 2;
  // Too small to crop without leaving an empty side: keep the picture as it is.
  if (cropWidth < 2 || cropHeight < 2) return null;

  const x = Math.floor((width - cropWidth) / 2);
  const y = Math.floor((height - cropHeight) / 2);
  return `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
}

// Quality 1-100 mapped to MJPEG qscale (2 is best, 31 is worst). Values outside the range are clamped.
const jpegQscale = (quality) => Math.round(2 + ((100 - Math.min(100, Math.max(1, quality))) * 29) / 99);

const IMAGE_CODECS = {
  jpg: (quality) => ["-c:v", "mjpeg", "-q:v", String(jpegQscale(quality))],
  png: () => ["-c:v", "png"],
  bmp: () => ["-c:v", "bmp"],
};

// Formats without transparency: transparent pixels must be flattened onto white, not black.
const OPAQUE_PIXEL_FORMAT = { jpg: "yuvj420p", bmp: "bgr24" };

export function buildImageArgs({ input, output, format, quality = 85, scalePercent = 100, ratio = "original", width, height }) {
  const filters = [];
  const crop = cropFilter(ratio, width, height);
  if (crop) filters.push(crop);
  if (scalePercent < 100) {
    const factor = scalePercent / 100;
    // Never scale below 2 px, and keep dimensions even.
    filters.push(`scale=max(2\\,trunc(iw*${factor}/2)*2):max(2\\,trunc(ih*${factor}/2)*2)`);
  }

  const common = ["-frames:v", "1"];
  const codec = IMAGE_CODECS[format](quality);

  if (OPAQUE_PIXEL_FORMAT[format] && width && height) {
    const chain = [...filters, `format=${OPAQUE_PIXEL_FORMAT[format]}`];
    const graph = `color=c=white:s=${width}x${height},format=rgba[bg];[0:v]format=rgba[fg];[bg][fg]overlay=format=auto,${chain.join(",")}[out]`;
    return ["-y", "-i", input, "-filter_complex", graph, "-map", "[out]", ...common, ...codec, output];
  }

  return [
    "-y",
    "-i", input,
    ...(filters.length ? ["-vf", filters.join(",")] : []),
    ...common,
    ...codec,
    output,
  ];
}

export function buildGifArgs({ input, output, fps = 15, width = 480, speed = 1, ratio = "original", inputWidth, inputHeight, still = false }) {
  const pre = [];
  const crop = cropFilter(ratio, inputWidth, inputHeight);
  if (crop) pre.push(crop);
  if (speed !== 1) pre.push(`setpts=PTS/${speed}`);
  // fps needs a timeline: a single still frame has none, so it would be dropped and the GIF left empty.
  if (!still) pre.push(`fps=${fps}`);
  // Scale down only: a small source keeps its size instead of being blurred up.
  pre.push(`scale='min(iw\\,${width})':-2:flags=lanczos`);

  // Two-pass palette: better colors than the default GIF palette, same encoder.
  const graph = `[0:v]${pre.join(",")},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`;
  return ["-y", "-i", input, "-filter_complex", graph, "-an", "-loop", "0", output];
}

const AUDIO_CODECS = {
  mp3: (kbps) => ["-c:a", "libmp3lame", "-b:a", `${kbps}k`],
  m4a: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
  ogg: (kbps) => ["-c:a", "libopus", "-b:a", `${kbps}k`],
  wav: () => ["-c:a", "pcm_s16le"],
  flac: () => ["-c:a", "flac"],
};

export function buildAudioArgs({ input, output, format, bitrate = 128, speed = 1 }) {
  const af = speed !== 1 ? ["-af", `atempo=${speed}`] : [];
  return ["-y", "-i", input, "-vn", ...af, ...AUDIO_CODECS[format](bitrate), output];
}

export function buildVideoArgs({
  input,
  output,
  format,
  height = 0,
  bitrate = 2000,
  speed = 1,
  ratio = "original",
  inputWidth,
  inputHeight,
  keepAudio = true,
  hardware = false,
}) {
  const filters = [];
  const crop = cropFilter(ratio, inputWidth, inputHeight);
  if (crop) filters.push(crop);
  if (height) filters.push(`scale=-2:min(ih\\,${height})`);
  if (speed !== 1) filters.push(`setpts=PTS/${speed}`);
  filters.push("format=yuv420p");

  let video;
  if (format === "webm") {
    video = ["-c:v", "libvpx", "-b:v", `${bitrate}k`, "-deadline", "realtime", "-cpu-used", "6"];
  } else if (hardware) {
    video = ["-c:v", "h264_mediacodec", "-b:v", `${bitrate}k`];
  } else {
    video = ["-c:v", "libopenh264", "-b:v", `${bitrate}k`];
  }

  let audio;
  if (!keepAudio) {
    audio = ["-an"];
  } else {
    const af = speed !== 1 ? ["-af", `atempo=${speed}`] : [];
    const codec = format === "webm" ? ["-c:a", "libopus", "-b:a", "96k"] : ["-c:a", "aac", "-b:a", "128k"];
    audio = [...af, ...codec];
  }

  const mux = format === "mp4" ? ["-movflags", "+faststart"] : [];
  return ["-y", "-i", input, "-vf", filters.join(","), ...video, ...audio, ...mux, output];
}

// True when the device has a hardware AVC (H.264) encoder that FFmpeg's h264_mediacodec can use.
export function hasHardwareH264() {
  try {
    return getEncoders("video/avc").some((encoder) => encoder.hardware);
  } catch {
    return false;
  }
}
