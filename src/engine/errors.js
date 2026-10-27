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
export function keyForFfmpeg(output = "") {
  if (/Unknown encoder|Unknown decoder|Unknown (?:input|output) format|Encoder .* not found|Decoder .* not found|No such filter/i.test(output)) {
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
