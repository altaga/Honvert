import { requireNativeModule } from "expo";

// Local-only native engine. See android/src/main/java/.../HonvertEngineModule.kt
const Native = requireNativeModule("HonvertEngine");

export const execute = (id, args, durationMs, labels) => Native.execute(id, args, durationMs, labels);
export const cancel = (sessionId) => Native.cancel(sessionId);
export const probe = (path) => Native.probe(path);
export const pdfPageCount = (path) => Native.pdfPageCount(path);
export const encodeWebp = (inPath, outPath, quality) => Native.encodeWebp(inPath, outPath, quality);
export const decodeImage = (inPath, outPath) => Native.decodeImage(inPath, outPath);
export const exifOrientation = (path) => Native.exifOrientation(path);
export const renderPdfPage = (pdfPath, pageIndex, dpi, format, quality, outPath) =>
  Native.renderPdfPage(pdfPath, pageIndex, dpi, format, quality, outPath);
export const getEncoders = (mime) => Native.getEncoders(mime);

// Copies a finished file into a folder picked with the system folder picker. Returns the new document URI.
export const saveToFolder = (inPath, treeUri, fileName, mimeType) => Native.saveToFolder(inPath, treeUri, fileName, mimeType);

// Repair (see RepairTools.kt). Each call writes a best-effort output file and returns its path.
export const repairSniff = (path) => Native.repairSniff(path);
export const repairStrip = (inPath, outPath, offset) => Native.repairStrip(inPath, outPath, offset);
export const repairJpegEoi = (inPath, outPath) => Native.repairJpegEoi(inPath, outPath);
export const repairGifTrailer = (inPath, outPath) => Native.repairGifTrailer(inPath, outPath);
export const repairPng = (inPath, outPath) => Native.repairPng(inPath, outPath);
export const repairZip = (inPath, outPath) => Native.repairZip(inPath, outPath);
export const repairPdf = (inPath, outPath) => Native.repairPdf(inPath, outPath);
export const extractH264 = (inPath, outPath, referencePath) => Native.extractH264(inPath, outPath, referencePath ?? null);

// First video frame as an upright JPEG no larger than maxSide, for the crop box preview.
export const videoFrame = (inPath, outPath, maxSide) => Native.videoFrame(inPath, outPath, maxSide);

// System file picker that survives the app being killed while it is open (see PickerActivity.kt).
// Both return JSON: { canceled, tag, files: [{ name, path, mime, size }], error }.
export const pickFiles = (types, multiple, tag) => Native.pickFiles(types, multiple, tag);
export const takePendingPick = () => Native.takePendingPick();

// Saves a finished file into DCIM/Honvert/<tool> (pictures, videos) or Download/Honvert/<tool> (the rest).
// Returns that folder. Rejects with "unsupported" on Android 9 and older.
export const saveToDevice = (inPath, fileName, mimeType, tool) => Native.saveToDevice(inPath, fileName, mimeType, tool);

// Opens a finished file in a viewer app. Rejects with "no app" when nothing can open it.
export const openFile = (path, mime) => Native.openFile(path, mime);

// PDF passwords (see PdfSecurity.kt). A wrong password rejects with "wrong password".
export const pdfProtect = (inPath, outPath, password) => Native.pdfProtect(inPath, outPath, password);
export const pdfUnlock = (inPath, outPath, password) => Native.pdfUnlock(inPath, outPath, password);

export const onStart =(listener) => Native.addListener("onStart", listener);
export const onProgress = (listener) => Native.addListener("onProgress", listener);
