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

// Repair (see RepairTools.kt). Each call writes a best-effort output file and returns its path.
export const repairSniff = (path) => Native.repairSniff(path);
export const repairStrip = (inPath, outPath, offset) => Native.repairStrip(inPath, outPath, offset);
export const repairJpegEoi = (inPath, outPath) => Native.repairJpegEoi(inPath, outPath);
export const repairGifTrailer = (inPath, outPath) => Native.repairGifTrailer(inPath, outPath);
export const repairPng = (inPath, outPath) => Native.repairPng(inPath, outPath);
export const repairZip = (inPath, outPath) => Native.repairZip(inPath, outPath);
export const repairPdf = (inPath, outPath) => Native.repairPdf(inPath, outPath);
export const extractH264 = (inPath, outPath, referencePath) => Native.extractH264(inPath, outPath, referencePath ?? null);

export const onStart = (listener) => Native.addListener("onStart", listener);
export const onProgress = (listener) => Native.addListener("onProgress", listener);
