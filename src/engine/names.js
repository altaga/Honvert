// File-name and output-extension helpers. No native code here, so the unit tests can cover every edge case.

// Characters a file system refuses or that break paths: separators, reserved punctuation and control characters.
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]+/g;
// Generated names also turn whitespace into underscores, so they read as one token.
const FORBIDDEN_IN_STEM = /[\\/:*?"<>|\u0000-\u001f\s]+/g;

// Android allows 255 bytes per name. These limits keep the whole output name under that, extension included.
const GENERATED_STEM_BYTES = 96;
const TYPED_STEM_BYTES = 200;

// ZIP-based documents and e-books keep their own extension when they have one.
const REPAIR_OFFICE = ["docx", "xlsx", "pptx", "odt", "ods", "odp", "epub"];

const utf8Size = (code) => (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);

// Cuts text to at most maxBytes of UTF-8. It never splits a character, so an emoji always stays whole.
export function clipBytes(text, maxBytes) {
  let used = 0;
  let out = "";
  for (const char of text) {
    const size = utf8Size(char.codePointAt(0));
    if (used + size > maxBytes) break;
    used += size;
    out += char;
  }
  return out;
}

export function withoutExtension(name) {
  return name.replace(/\.[^.]+$/, "");
}

// Readable name for a generated output: any script, safe characters, short enough for the file system.
export function stemOf(name) {
  return clipBytes(withoutExtension(name).replace(FORBIDDEN_IN_STEM, "_"), GENERATED_STEM_BYTES) || "file";
}

// The copy keeps the result's format: the typed name loses any extension it already has and any character
// that is not allowed in a file name, then gets the result's extension back.
export function fileNameFor(typed, original) {
  const ext = (original.includes(".") ? original.split(".").pop() : "").replace(FORBIDDEN, "_");
  let stem = (typed ?? "").trim();
  if (ext && stem.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) stem = stem.slice(0, -(ext.length + 1));
  stem = clipBytes(stem.replace(FORBIDDEN, "_"), TYPED_STEM_BYTES).trim() || "honvert";
  return ext ? `${stem}.${ext}` : stem;
}

// Output extension for a detected type.
export function repairExtension(type, name) {
  const original = (name.split(".").pop() || "").toLowerCase();
  if (type === "zip") return REPAIR_OFFICE.includes(original) ? original : "zip";
  if (type === "jpeg") return "jpg";
  if (type === "unknown") return null;
  return type;
}

// Video that cannot be remuxed is re-encoded: slow, but tolerant of broken packets.
// The output keeps its container when H.264 and AAC fit it, and becomes MP4 otherwise.
// Only the file name is inspected, so a dot in a folder name cannot change the result.
export function reencodeTarget(output) {
  const slash = output.lastIndexOf("/");
  const dot = output.lastIndexOf(".");
  const hasExtension = dot > slash + 1;
  if (hasExtension && ["mp4", "mov", "mkv"].includes(output.slice(dot + 1).toLowerCase())) return output;
  return `${hasExtension ? output.slice(0, dot) : output}.mp4`;
}
