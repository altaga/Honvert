// Per-category configuration. Labels are translation keys (see src/i18n/locales). Choices with a
// fixed technical label (JPG, 720p, 2x) use `label`; the rest use `labelKey`.
// A control is a set of choices unless it has a `type`: "time" is a start/end range in milliseconds
// (keys startMs and endMs), "text" is a single text field.

export const RATIO_CHOICES = [
  { value: "original", labelKey: "ch.original" },
  { value: "free", labelKey: "ch.free" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

const SPEED_CHOICES = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1, label: "1x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];

const QUALITY_CHOICES = [
  { value: "high", labelKey: "ch.high" },
  { value: "medium", labelKey: "ch.medium" },
  { value: "low", labelKey: "ch.low" },
];

const ROTATE_CHOICES = [
  { value: 0, label: "0°" },
  { value: 90, label: "90°" },
  { value: 180, label: "180°" },
  { value: 270, label: "270°" },
];

const FLIP_CHOICES = [
  { value: "none", labelKey: "ch.none" },
  { value: "horizontal", labelKey: "ch.flipHorizontal" },
  { value: "vertical", labelKey: "ch.flipVertical" },
];

const ON_OFF = [
  { value: false, labelKey: "ch.off" },
  { value: true, labelKey: "ch.on" },
];

const TRIM = { key: "trim", type: "time", labelKey: "opt.trim" };

export const PDF_MODES = {
  "images-to-pdf": { labelKey: "mode.imagesToPdf", acceptKey: "accept.imagesToPdf", picker: ["image/*"], multiple: true },
  merge: { labelKey: "mode.merge", acceptKey: "accept.pdfMany", picker: ["application/pdf"], multiple: true },
  split: { labelKey: "mode.split", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  extract: { labelKey: "mode.extract", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  organize: { labelKey: "mode.organize", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  rotate: { labelKey: "mode.rotate", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  "to-images": { labelKey: "mode.toImages", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  compress: { labelKey: "mode.compress", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  watermark: { labelKey: "mode.watermark", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  protect: { labelKey: "mode.protect", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  unlock: { labelKey: "mode.unlock", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
};

export const CATEGORIES = {
  image: {
    titleKey: "cat.image.title",
    subtitleKey: "cat.image.subtitle",
    formatsKey: "cat.image.formats",
    acceptKey: "accept.image",
    picker: { types: ["image/*"], multiple: true },
    defaults: {
      format: "jpg",
      quality: 90,
      scalePercent: 100,
      pixelWidth: "",
      pixelHeight: "",
      ratio: "original",
      cropRect: null,
      rotate: 0,
      flip: "none",
    },
    advanced: ["ratio", "rotate", "flip"],
    controls: [
      {
        key: "format",
        labelKey: "opt.format",
        choices: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WEBP" },
          { value: "tiff", label: "TIFF" },
          { value: "bmp", label: "BMP" },
          { value: "ico", label: "ICO" },
        ],
      },
      {
        key: "quality",
        labelKey: "opt.quality",
        visible: (o) => o.format === "jpg" || o.format === "webp",
        choices: [
          { value: 90, labelKey: "ch.high" },
          { value: 70, labelKey: "ch.medium" },
          { value: 40, labelKey: "ch.low" },
        ],
      },
      {
        key: "scalePercent",
        labelKey: "opt.size",
        choices: [
          { value: 100, label: "100%" },
          { value: 75, label: "75%" },
          { value: 50, label: "50%" },
          { value: 25, label: "25%" },
          { value: "custom", labelKey: "ch.custom" },
        ],
      },
      {
        key: "pixelWidth",
        type: "text",
        labelKey: "opt.pixelWidth",
        hintKey: "hint.pixels",
        keyboard: "number-pad",
        visible: (o) => o.scalePercent === "custom",
      },
      {
        key: "pixelHeight",
        type: "text",
        labelKey: "opt.pixelHeight",
        keyboard: "number-pad",
        visible: (o) => o.scalePercent === "custom",
      },
      { key: "ratio", labelKey: "opt.crop", choices: RATIO_CHOICES },
      { key: "rotate", labelKey: "opt.rotate", choices: ROTATE_CHOICES },
      { key: "flip", labelKey: "opt.flip", choices: FLIP_CHOICES },
    ],
  },

  gif: {
    titleKey: "cat.gif.title",
    subtitleKey: "cat.gif.subtitle",
    formatsKey: "cat.gif.formats",
    acceptKey: "accept.gif",
    picker: { types: ["image/gif", "video/*"], multiple: true },
    defaults: {
      fps: 15,
      width: 480,
      speed: 1,
      ratio: "original",
      cropRect: null,
      playback: "forward",
      loop: "forever",
      colors: 256,
      dither: "bayer",
      startMs: 0,
      endMs: 0,
    },
    advanced: ["speed", "ratio", "playback", "loop", "colors", "dither", "trim"],
    controls: [
      {
        key: "fps",
        labelKey: "opt.fps",
        choices: [
          { value: 10, label: "10" },
          { value: 15, label: "15" },
          { value: 24, label: "24" },
        ],
      },
      {
        key: "width",
        labelKey: "opt.width",
        choices: [
          { value: 320, label: "320" },
          { value: 480, label: "480" },
          { value: 720, label: "720" },
        ],
      },
      {
        key: "speed",
        labelKey: "opt.speed",
        choices: [
          { value: 0.5, label: "0.5x" },
          { value: 1, label: "1x" },
          { value: 2, label: "2x" },
        ],
      },
      { key: "ratio", labelKey: "opt.crop", choices: RATIO_CHOICES },
      {
        key: "playback",
        labelKey: "opt.playback",
        choices: [
          { value: "forward", labelKey: "ch.forward" },
          { value: "reverse", labelKey: "ch.reverse" },
          { value: "boomerang", labelKey: "ch.boomerang" },
        ],
      },
      {
        key: "loop",
        labelKey: "opt.loop",
        choices: [
          { value: "forever", labelKey: "ch.forever" },
          { value: "once", labelKey: "ch.once" },
          { value: "three", label: "3x" },
        ],
      },
      {
        key: "colors",
        labelKey: "opt.colors",
        choices: [
          { value: 256, label: "256" },
          { value: 128, label: "128" },
          { value: 64, label: "64" },
          { value: 32, label: "32" },
        ],
      },
      {
        key: "dither",
        labelKey: "opt.dither",
        choices: [
          { value: "bayer", labelKey: "ch.ditherPattern" },
          { value: "sierra2_4a", labelKey: "ch.ditherSmooth" },
          { value: "none", labelKey: "ch.none" },
        ],
      },
      TRIM,
    ],
  },

  audio: {
    titleKey: "cat.audio.title",
    subtitleKey: "cat.audio.subtitle",
    formatsKey: "cat.audio.formats",
    acceptKey: "accept.audio",
    picker: { types: ["audio/*", "video/*"], multiple: true },
    defaults: {
      format: "mp3",
      bitrate: 128,
      speed: 1,
      channels: "original",
      normalize: false,
      startMs: 0,
      endMs: 0,
      title: "",
      artist: "",
      album: "",
      year: "",
    },
    advanced: ["speed", "channels", "normalize", "trim", "title", "artist", "album", "year"],
    controls: [
      {
        key: "format",
        labelKey: "opt.format",
        choices: [
          { value: "mp3", label: "MP3" },
          { value: "m4a", label: "M4A" },
          { value: "aac", label: "AAC" },
          { value: "opus", label: "OPUS" },
          { value: "ogg", label: "OGG" },
          { value: "wav", label: "WAV" },
          { value: "flac", label: "FLAC" },
          { value: "alac", label: "ALAC" },
        ],
      },
      {
        key: "bitrate",
        labelKey: "opt.bitrate",
        visible: (o) => ["mp3", "m4a", "aac", "opus", "ogg"].includes(o.format),
        choices: [
          { value: 96, label: "96" },
          { value: 128, label: "128" },
          { value: 192, label: "192" },
          { value: 320, label: "320" },
        ],
      },
      { key: "speed", labelKey: "opt.speed", choices: SPEED_CHOICES },
      {
        key: "channels",
        labelKey: "opt.channels",
        choices: [
          { value: "original", labelKey: "ch.original" },
          { value: "mono", labelKey: "ch.mono" },
          { value: "stereo", labelKey: "ch.stereo" },
        ],
      },
      { key: "normalize", labelKey: "opt.normalize", choices: ON_OFF },
      TRIM,
      { key: "title", type: "text", labelKey: "opt.tagTitle" },
      { key: "artist", type: "text", labelKey: "opt.tagArtist" },
      { key: "album", type: "text", labelKey: "opt.tagAlbum" },
      { key: "year", type: "text", labelKey: "opt.tagYear", keyboard: "number-pad" },
    ],
  },

  video: {
    titleKey: "cat.video.title",
    subtitleKey: "cat.video.subtitle",
    formatsKey: "cat.video.formats",
    acceptKey: "accept.video",
    picker: { types: ["video/*", "image/gif"], multiple: true },
    defaults: {
      format: "mp4",
      height: 720,
      bitrate: 2000,
      fps: 0,
      speed: 1,
      ratio: "original",
      cropRect: null,
      rotate: 0,
      flip: "none",
      keepAudio: true,
      normalize: false,
      metadata: "remove",
      gpu: true,
      startMs: 0,
      endMs: 0,
    },
    advanced: ["fps", "speed", "ratio", "rotate", "flip", "keepAudio", "normalize", "metadata", "gpu", "trim"],
    controls: [
      {
        key: "format",
        labelKey: "opt.format",
        choices: [
          { value: "mp4", label: "MP4" },
          { value: "mkv", label: "MKV" },
          { value: "mov", label: "MOV" },
          { value: "avi", label: "AVI" },
          { value: "webm", label: "WEBM" },
        ],
      },
      {
        key: "height",
        labelKey: "opt.resolution",
        choices: [
          { value: 0, labelKey: "ch.original" },
          { value: 2160, label: "4K" },
          { value: 1080, label: "1080p" },
          { value: 720, label: "720p" },
          { value: 480, label: "480p" },
          { value: 360, label: "360p" },
        ],
      },
      {
        key: "bitrate",
        labelKey: "opt.quality",
        choices: [
          { value: 8000, labelKey: "ch.max" },
          { value: 4000, labelKey: "ch.high" },
          { value: 2000, labelKey: "ch.medium" },
          { value: 800, labelKey: "ch.low" },
        ],
      },
      {
        key: "fps",
        labelKey: "opt.fps",
        choices: [
          { value: 0, labelKey: "ch.original" },
          { value: 24, label: "24" },
          { value: 30, label: "30" },
          { value: 60, label: "60" },
        ],
      },
      { key: "speed", labelKey: "opt.speed", choices: SPEED_CHOICES },
      { key: "ratio", labelKey: "opt.crop", choices: RATIO_CHOICES },
      { key: "rotate", labelKey: "opt.rotate", choices: ROTATE_CHOICES },
      { key: "flip", labelKey: "opt.flip", choices: FLIP_CHOICES },
      {
        key: "keepAudio",
        labelKey: "opt.audio",
        choices: [
          { value: true, labelKey: "ch.withAudio" },
          { value: false, labelKey: "ch.noAudio" },
        ],
      },
      { key: "normalize", labelKey: "opt.normalize", visible: (o) => o.keepAudio, choices: ON_OFF },
      {
        key: "metadata",
        labelKey: "opt.metadata",
        choices: [
          { value: "remove", labelKey: "ch.remove" },
          { value: "keep", labelKey: "ch.keep" },
        ],
      },
      {
        key: "gpu",
        labelKey: "opt.encoder",
        visible: (o) => ["mp4", "mkv", "mov"].includes(o.format),
        choices: [
          { value: true, labelKey: "ch.gpu" },
          { value: false, labelKey: "ch.cpu" },
        ],
      },
      TRIM,
    ],
  },

  pdf: {
    titleKey: "cat.pdf.title",
    subtitleKey: "cat.pdf.subtitle",
    formatsKey: "cat.pdf.formats",
    defaults: {
      mode: "images-to-pdf",
      quality: "medium",
      format: "jpg",
      pages: "",
      order: "",
      rotate: 90,
      password: "",
      watermark: "",
      opacity: 0.2,
    },
    advanced: [],
    modes: PDF_MODES,
    controls: [
      {
        key: "mode",
        labelKey: "opt.action",
        choices: Object.entries(PDF_MODES).map(([value, mode]) => ({ value, labelKey: mode.labelKey })),
      },
      {
        key: "quality",
        labelKey: "opt.quality",
        visible: (o) => o.mode === "images-to-pdf" || o.mode === "to-images" || o.mode === "compress",
        choices: QUALITY_CHOICES,
      },
      {
        key: "format",
        labelKey: "opt.format",
        visible: (o) => o.mode === "to-images",
        choices: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
        ],
      },
      { key: "pages", type: "text", labelKey: "opt.pages", hintKey: "hint.pages", visible: (o) => o.mode === "extract" },
      { key: "order", type: "text", labelKey: "opt.order", hintKey: "hint.order", visible: (o) => o.mode === "organize" },
      { key: "pages", type: "text", labelKey: "opt.pages", hintKey: "hint.pagesAll", visible: (o) => o.mode === "rotate" },
      {
        key: "rotate",
        labelKey: "opt.rotate",
        visible: (o) => o.mode === "rotate",
        choices: ROTATE_CHOICES.filter((choice) => choice.value !== 0),
      },
      { key: "watermark", type: "text", labelKey: "opt.watermarkText", visible: (o) => o.mode === "watermark" },
      {
        key: "opacity",
        labelKey: "opt.opacity",
        visible: (o) => o.mode === "watermark",
        choices: [
          { value: 0.1, label: "10%" },
          { value: 0.2, label: "20%" },
          { value: 0.4, label: "40%" },
        ],
      },
      {
        key: "password",
        type: "text",
        secure: true,
        labelKey: "opt.password",
        visible: (o) => o.mode === "protect" || o.mode === "unlock",
      },
    ],
  },

  // Repair has no settings: it keeps whatever FFmpeg (or Android) can still read from a damaged file.
  repair: {
    titleKey: "cat.repair.title",
    subtitleKey: "cat.repair.subtitle",
    formatsKey: "cat.repair.formats",
    acceptKey: "accept.repair",
    picker: { types: ["*/*"], multiple: true },
    defaults: {},
    advanced: [],
    controls: [],
  },
};

// Quality presets used by the PDF actions.
export const PDF_QUALITY = {
  high: { dpi: 150, jpegQuality: 90 },
  medium: { dpi: 110, jpegQuality: 75 },
  low: { dpi: 72, jpegQuality: 55 },
};

// Parses "1-3, 5, 8-" into sorted, unique 1-based page numbers within pageCount. Invalid parts are ignored.
export function parsePageRanges(text, pageCount) {
  const pages = new Set();
  for (const part of String(text ?? "").split(",")) {
    const match = /^\s*(\d*)\s*(?:-\s*(\d*))?\s*$/.exec(part);
    if (!match || (match[1] === "" && match[2] === undefined)) continue;
    const isRange = part.includes("-");
    const start = match[1] === "" ? 1 : Number(match[1]);
    const end = isRange ? (match[2] === "" || match[2] === undefined ? pageCount : Number(match[2])) : start;
    for (let page = Math.max(1, start); page <= Math.min(pageCount, end); page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

// Like parsePageRanges, but keeps the order typed ("3, 1-2" is 3, 1, 2). A page typed twice keeps its
// first place. Used to reorder a PDF; pages left out are dropped.
export function parsePageOrder(text, pageCount) {
  const pages = [];
  const seen = new Set();
  for (const part of String(text ?? "").split(",")) {
    for (const page of parsePageRanges(part, pageCount)) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }
  return pages;
}

// "1:05", "65", "1:02:03" or "1:05.5" to milliseconds. Empty or invalid text is 0.
export function parseTime(text) {
  const value = String(text ?? "").trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(value)) return 0;
  const [whole, fraction = ""] = value.split(".");
  const seconds = whole.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round((seconds + Number(`0.${fraction || 0}`)) * 1000);
}

// Milliseconds to "m:ss" or "h:mm:ss", the inverse of parseTime for whole seconds.
export function formatTime(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
