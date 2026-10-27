// Per-category configuration. Labels are translation keys (see src/i18n/locales). Choices with a
// fixed technical label (JPG, 720p, 2x) use `label`; the rest use `labelKey`.

export const RATIO_CHOICES = [
  { value: "original", labelKey: "ch.original" },
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

export const PDF_MODES = {
  "images-to-pdf": { labelKey: "mode.imagesToPdf", acceptKey: "accept.imagesToPdf", picker: ["image/*"], multiple: true },
  merge: { labelKey: "mode.merge", acceptKey: "accept.pdfMany", picker: ["application/pdf"], multiple: true },
  split: { labelKey: "mode.split", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  "to-images": { labelKey: "mode.toImages", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
  compress: { labelKey: "mode.compress", acceptKey: "accept.pdf", picker: ["application/pdf"], multiple: false },
};

export const CATEGORIES = {
  image: {
    titleKey: "cat.image.title",
    subtitleKey: "cat.image.subtitle",
    formatsKey: "cat.image.formats",
    acceptKey: "accept.image",
    picker: { types: ["image/*"], multiple: false },
    defaults: { format: "jpg", quality: 85, scalePercent: 100, ratio: "original" },
    advanced: ["ratio"],
    controls: [
      {
        key: "format",
        labelKey: "opt.format",
        choices: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WEBP" },
          { value: "bmp", label: "BMP" },
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
        ],
      },
      { key: "ratio", labelKey: "opt.crop", choices: RATIO_CHOICES },
    ],
  },

  gif: {
    titleKey: "cat.gif.title",
    subtitleKey: "cat.gif.subtitle",
    formatsKey: "cat.gif.formats",
    acceptKey: "accept.gif",
    picker: { types: ["image/gif", "video/*"], multiple: false },
    defaults: { fps: 15, width: 480, speed: 1, ratio: "original" },
    advanced: ["speed", "ratio"],
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
    ],
  },

  audio: {
    titleKey: "cat.audio.title",
    subtitleKey: "cat.audio.subtitle",
    formatsKey: "cat.audio.formats",
    acceptKey: "accept.audio",
    picker: { types: ["audio/*", "video/*"], multiple: false },
    defaults: { format: "mp3", bitrate: 128, speed: 1 },
    advanced: ["speed"],
    controls: [
      {
        key: "format",
        labelKey: "opt.format",
        choices: [
          { value: "mp3", label: "MP3" },
          { value: "m4a", label: "M4A" },
          { value: "ogg", label: "OGG" },
          { value: "wav", label: "WAV" },
          { value: "flac", label: "FLAC" },
        ],
      },
      {
        key: "bitrate",
        labelKey: "opt.bitrate",
        visible: (o) => ["mp3", "m4a", "ogg"].includes(o.format),
        choices: [
          { value: 96, label: "96" },
          { value: 128, label: "128" },
          { value: 192, label: "192" },
          { value: 320, label: "320" },
        ],
      },
      { key: "speed", labelKey: "opt.speed", choices: SPEED_CHOICES },
    ],
  },

  video: {
    titleKey: "cat.video.title",
    subtitleKey: "cat.video.subtitle",
    formatsKey: "cat.video.formats",
    acceptKey: "accept.video",
    picker: { types: ["video/*"], multiple: false },
    defaults: { format: "mp4", height: 720, bitrate: 2000, speed: 1, ratio: "original", keepAudio: true, gpu: true },
    advanced: ["speed", "ratio", "keepAudio", "gpu"],
    controls: [
      {
        key: "format",
        labelKey: "opt.format",
        choices: [
          { value: "mp4", label: "MP4" },
          { value: "webm", label: "WEBM" },
        ],
      },
      {
        key: "height",
        labelKey: "opt.resolution",
        choices: [
          { value: 0, labelKey: "ch.original" },
          { value: 720, label: "720p" },
          { value: 480, label: "480p" },
          { value: 360, label: "360p" },
        ],
      },
      {
        key: "bitrate",
        labelKey: "opt.quality",
        choices: [
          { value: 4000, labelKey: "ch.high" },
          { value: 2000, labelKey: "ch.medium" },
          { value: 800, labelKey: "ch.low" },
        ],
      },
      { key: "speed", labelKey: "opt.speed", choices: SPEED_CHOICES },
      { key: "ratio", labelKey: "opt.crop", choices: RATIO_CHOICES },
      {
        key: "keepAudio",
        labelKey: "opt.audio",
        choices: [
          { value: true, labelKey: "ch.withAudio" },
          { value: false, labelKey: "ch.noAudio" },
        ],
      },
      {
        key: "gpu",
        labelKey: "opt.encoder",
        visible: (o) => o.format === "mp4",
        choices: [
          { value: true, labelKey: "ch.gpu" },
          { value: false, labelKey: "ch.cpu" },
        ],
      },
    ],
  },

  pdf: {
    titleKey: "cat.pdf.title",
    subtitleKey: "cat.pdf.subtitle",
    formatsKey: "cat.pdf.formats",
    defaults: { mode: "images-to-pdf", quality: "medium", format: "jpg" },
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
        visible: (o) => o.mode !== "merge" && o.mode !== "split",
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
