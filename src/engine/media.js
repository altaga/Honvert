import { getEncoders, probe } from "../../modules/honvert-engine";
import { rectFilter } from "./crop";
import { RATIOS } from "./ratios";

export { RATIOS };

// The user's box when there is one, otherwise the centered preset.
const cropFor = (cropRect, ratio, width, height) =>
  (cropRect ? rectFilter(cropRect, width, height) : null) ?? cropFilter(ratio, width, height);

// Codecs FFmpeg decodes natively in this build. Anything else (WEBP, HEIC, AVIF...) goes through Android.
export const FFMPEG_IMAGE_CODECS = new Set(["mjpeg", "png", "bmp", "gif", "tiff", "jpeg2000"]);

// File extension for each output format. Formats not listed use their own name.
const EXTENSIONS = { alac: "m4a" };
export const extensionFor = (format) => EXTENSIONS[format] ?? format;

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

// Clockwise rotation (0, 90, 180, 270) and mirroring ("none", "horizontal", "vertical") as filters.
export function orientFilters(rotate = 0, flip = "none") {
  const filters = [];
  if (flip === "horizontal") filters.push("hflip");
  if (flip === "vertical") filters.push("vflip");
  if (rotate === 90) filters.push("transpose=1");
  if (rotate === 180) filters.push("hflip", "vflip");
  if (rotate === 270) filters.push("transpose=2");
  return filters;
}

// Quality 1-100 mapped to MJPEG qscale (2 is best, 31 is worst). Values outside the range are clamped.
const jpegQscale = (quality) => Math.round(2 + ((100 - Math.min(100, Math.max(1, quality))) * 29) / 99);

const IMAGE_CODECS = {
  jpg: (quality) => ["-c:v", "mjpeg", "-q:v", String(jpegQscale(quality))],
  png: () => ["-c:v", "png"],
  bmp: () => ["-c:v", "bmp"],
  tiff: () => ["-c:v", "tiff", "-compression_algo", "deflate"],
  // Icons hold PNG frames; the format caps each side at 256 px.
  ico: () => ["-c:v", "png"],
};

// Exact output size in pixels after crop and rotation. One empty side follows the other's proportion.
export function pixelScale(pixelWidth, pixelHeight) {
  const toSide = (value) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= 2 ? Math.min(number, 16384) : 0;
  };
  const w = toSide(pixelWidth);
  const h = toSide(pixelHeight);
  if (!w && !h) return null;
  return `scale=${w || -2}:${h || -2}:flags=lanczos`;
}

// Formats without transparency: transparent pixels must be flattened onto white, not black.
const OPAQUE_PIXEL_FORMAT = { jpg: "yuvj420p", bmp: "bgr24" };

// No metadata is copied into images: location, camera and date never leave with the picture.
export function buildImageArgs({
  input,
  output,
  format,
  quality = 85,
  scalePercent = 100,
  ratio = "original",
  width,
  height,
  rotate = 0,
  flip = "none",
  cropRect = null,
  pixelWidth = "",
  pixelHeight = "",
}) {
  const filters = [];
  const crop = cropFor(cropRect, ratio, width, height);
  if (crop) filters.push(crop);
  const exact = scalePercent === "custom" ? pixelScale(pixelWidth, pixelHeight) : null;
  if (typeof scalePercent === "number" && scalePercent < 100) {
    const factor = scalePercent / 100;
    // Never scale below 2 px, and keep dimensions even.
    filters.push(`scale=max(2\\,trunc(iw*${factor}/2)*2):max(2\\,trunc(ih*${factor}/2)*2)`);
  }
  filters.push(...orientFilters(rotate, flip));
  // Exact pixels are the final size the user sees, so they apply after rotation.
  if (exact) filters.push(exact);
  // ICO holds PNG frames of at most 256 px, and FFmpeg's ICO writer only takes them as RGBA.
  if (format === "ico") filters.push("scale='min(256\\,iw)':'min(256\\,ih)':force_original_aspect_ratio=decrease", "format=rgba");

  const common = ["-frames:v", "1", "-map_metadata", "-1"];
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

// FFmpeg's GIF muxer: 0 loops forever, -1 plays once, N repeats N more times.
const GIF_LOOP = { forever: "0", once: "-1", three: "2" };
const GIF_COLORS = new Set([256, 128, 64, 32]);
const GIF_DITHER = new Set(["sierra2_4a", "bayer", "none"]);

export function buildGifArgs({
  input,
  output,
  fps = 15,
  width = 480,
  speed = 1,
  ratio = "original",
  inputWidth,
  inputHeight,
  still = false,
  playback = "forward",
  loop = "forever",
  startMs = 0,
  endMs = 0,
  cropRect = null,
  colors = 256,
  dither = "bayer",
}) {
  const pre = [];
  const crop = cropFor(cropRect, ratio, inputWidth, inputHeight);
  if (crop) pre.push(crop);
  if (speed !== 1) pre.push(`setpts=PTS/${speed}`);
  // fps needs a timeline: a single still frame has none, so it would be dropped and the GIF left empty.
  if (!still) pre.push(`fps=${fps}`);
  // Scale down only: a small source keeps its size instead of being blurred up.
  pre.push(`scale='min(iw\\,${width})':-2:flags=lanczos`);

  // Reverse and boomerang hold every frame in memory, so they only make sense for clips, not stills.
  let head = `[0:v]${pre.join(",")}`;
  if (!still && playback === "reverse") head += ",reverse";
  if (!still && playback === "boomerang") head += ",split[f][r];[r]reverse[rv];[f][rv]concat=n=2:v=1";

  // Two-pass palette: better colors than the default GIF palette, same encoder. Fewer colors make a
  // smaller file; the dither pattern hides the steps between them.
  const count = GIF_COLORS.has(colors) && colors < 256 ? `max_colors=${colors}:` : "";
  const pattern = GIF_DITHER.has(dither) ? dither : "bayer";
  const graph = `${head},split[a][b];[a]palettegen=${count}stats_mode=diff[p];[b][p]paletteuse=dither=${pattern}`;
  const trim = still ? [] : trimArgs(startMs, endMs);
  return ["-y", ...trim, "-i", input, "-filter_complex", graph, "-an", "-loop", GIF_LOOP[loop] ?? "0", output];
}

const AUDIO_CODECS = {
  mp3: (kbps) => ["-c:a", "libmp3lame", "-b:a", `${kbps}k`],
  m4a: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
  aac: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
  ogg: (kbps) => ["-c:a", "libopus", "-b:a", `${kbps}k`],
  opus: (kbps) => ["-c:a", "libopus", "-b:a", `${kbps}k`],
  wav: () => ["-c:a", "pcm_s16le"],
  flac: () => ["-c:a", "flac"],
  alac: () => ["-c:a", "alac"],
};

// Formats whose size is set by a bitrate. The lossless ones ignore it.
export const BITRATE_AUDIO = new Set(["mp3", "m4a", "aac", "ogg", "opus"]);

// Audio filters shared by the audio and video paths, in the order FFmpeg should run them.
function audioFilters({ speed = 1, normalize = false }) {
  const filters = [];
  if (speed !== 1) filters.push(`atempo=${speed}`);
  if (normalize) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  return filters;
}

// Trim range in seconds, read before the input so FFmpeg seeks instead of decoding the skipped part.
export function trimArgs(startMs = 0, endMs = 0) {
  const args = [];
  if (startMs > 0) args.push("-ss", (startMs / 1000).toFixed(3));
  if (endMs > startMs) args.push("-to", (endMs / 1000).toFixed(3));
  return args;
}

export function buildAudioArgs({
  input,
  output,
  format,
  bitrate = 128,
  speed = 1,
  channels = "original",
  normalize = false,
  startMs = 0,
  endMs = 0,
  tags = {},
}) {
  const filters = audioFilters({ speed, normalize });
  const af = filters.length ? ["-af", filters.join(",")] : [];
  const ac = channels === "mono" ? ["-ac", "1"] : channels === "stereo" ? ["-ac", "2"] : [];
  return [
    "-y",
    ...trimArgs(startMs, endMs),
    "-i", input,
    "-vn",
    ...af,
    ...ac,
    ...AUDIO_CODECS[format](bitrate),
    ...tagArgs(tags),
    output,
  ];
}

// Title, artist, album and year written over the source tags. Empty fields keep what the file had.
const TAG_NAMES = { title: "title", artist: "artist", album: "album", year: "date" };
export function tagArgs(tags = {}) {
  const args = [];
  for (const [key, name] of Object.entries(TAG_NAMES)) {
    const value = String(tags[key] ?? "").trim();
    if (value) args.push("-metadata", `${name}=${value}`);
  }
  return args;
}

// Containers that carry H.264 and AAC. WEBM carries VP8 and Opus instead.
const H264_CONTAINERS = new Set(["mp4", "mov", "mkv"]);

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
  fps = 0,
  rotate = 0,
  flip = "none",
  normalize = false,
  metadata = "remove",
  startMs = 0,
  endMs = 0,
  cropRect = null,
}) {
  const filters = [];
  const crop = cropFor(cropRect, ratio, inputWidth, inputHeight);
  if (crop) filters.push(crop);
  if (height) filters.push(`scale=-2:min(ih\\,${height})`);
  if (speed !== 1) filters.push(`setpts=PTS/${speed}`);
  if (fps) filters.push(`fps=${fps}`);
  filters.push(...orientFilters(rotate, flip));
  // H.264 and VP8 need even dimensions; GIFs and odd crops often are not.
  filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2", "format=yuv420p");

  let video;
  if (format === "webm") {
    video = ["-c:v", "libvpx", "-b:v", `${bitrate}k`, "-deadline", "realtime", "-cpu-used", "6"];
  } else if (format === "avi") {
    // Classic AVI: MPEG-4 Part 2 tagged as XviD, which old players and TVs read.
    video = ["-c:v", "mpeg4", "-vtag", "xvid", "-b:v", `${bitrate}k`];
  } else if (hardware && H264_CONTAINERS.has(format)) {
    video = ["-c:v", "h264_mediacodec", "-b:v", `${bitrate}k`];
  } else {
    video = ["-c:v", "libopenh264", "-b:v", `${bitrate}k`];
  }

  let audio;
  if (!keepAudio) {
    audio = ["-an"];
  } else {
    const filtersA = audioFilters({ speed, normalize });
    const af = filtersA.length ? ["-af", filtersA.join(",")] : [];
    const codec =
      format === "webm"
        ? ["-c:a", "libopus", "-b:a", "96k"]
        : format === "avi"
          ? ["-c:a", "libmp3lame", "-b:a", "192k"]
          : ["-c:a", "aac", "-b:a", "128k"];
    audio = [...af, ...codec];
  }

  // Location, device and date tags are dropped unless the user keeps them.
  const meta = metadata === "remove" ? ["-map_metadata", "-1"] : [];
  const mux = format === "mp4" || format === "mov" ? ["-movflags", "+faststart"] : [];
  return [
    "-y",
    ...trimArgs(startMs, endMs),
    "-i", input,
    "-vf", filters.join(","),
    ...video,
    ...audio,
    ...meta,
    ...mux,
    output,
  ];
}

// Output size in bytes for a bitrate-based encode, or 0 when it cannot be estimated.
export function estimateBytes({ durationMs = 0, videoKbps = 0, audioKbps = 0, speed = 1, startMs = 0, endMs = 0 }) {
  const end = endMs > startMs ? endMs : durationMs;
  const seconds = Math.max(0, end - startMs) / 1000 / (speed || 1);
  if (!seconds || (!videoKbps && !audioKbps)) return 0;
  return Math.round(((videoKbps + audioKbps) * 1000 * seconds) / 8);
}

// True when the device has a hardware AVC (H.264) encoder that FFmpeg's h264_mediacodec can use.
export function hasHardwareH264() {
  try {
    return getEncoders("video/avc").some((encoder) => encoder.hardware);
  } catch {
    return false;
  }
}
