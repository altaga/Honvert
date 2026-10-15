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

export const onStart = (listener) => Native.addListener("onStart", listener);
export const onProgress = (listener) => Native.addListener("onProgress", listener);
