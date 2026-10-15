import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import { PDFDocument } from "pdf-lib";
import { renderPdfPage } from "../../modules/honvert-engine";

export const toUri = (path) => `file://${path}`;

export async function readBytes(path) {
  const base64 = await FileSystem.readAsStringAsync(toUri(path), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export async function writeBytes(path, bytes) {
  await FileSystem.writeAsStringAsync(toUri(path), Buffer.from(bytes).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });
}

// Images (already JPEG) become one PDF page each, sized from their pixel dimensions at 96 dpi.
export async function pdfFromJpegs(entries) {
  const pdf = await PDFDocument.create();
  for (const { path, width, height } of entries) {
    const image = await pdf.embedJpg(await readBytes(path));
    const pageWidth = width * 0.75;
    const pageHeight = height * 0.75;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }
  return pdf.save();
}

export async function mergePdfs(paths) {
  const merged = await PDFDocument.create();
  for (const path of paths) {
    const source = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

// Returns one PDF per page as { pageNumber, bytes }.
export async function splitPdf(path) {
  const source = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
  const parts = [];
  for (let index = 0; index < source.getPageCount(); index++) {
    const part = await PDFDocument.create();
    const [page] = await part.copyPages(source, [index]);
    part.addPage(page);
    parts.push({ pageNumber: index + 1, bytes: await part.save() });
  }
  return parts;
}

export async function pageCount(path) {
  const source = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
  return source.getPageCount();
}

// Rebuilds each page as a JPEG at the given dpi. Text becomes pixels, so this is lossy.
export async function compressPdf(path, { dpi, quality, workDir, onPage }) {
  const source = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
  const out = await PDFDocument.create();

  for (let index = 0; index < source.getPageCount(); index++) {
    const { width, height } = source.getPage(index).getSize();
    const tmp = `${workDir}page-${index + 1}.jpg`;
    await renderPdfPage(path, index, dpi, "jpg", quality, tmp);
    const image = await out.embedJpg(await readBytes(tmp));
    const page = out.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    if (onPage) onPage(index + 1, source.getPageCount());
  }

  return out.save();
}

// Renders every page to an image file. Returns the list of output paths.
export async function pdfToImages(path, { dpi, format, quality, outputDir, stem, onPage }) {
  const total = await pageCount(path);
  const files = [];
  for (let index = 0; index < total; index++) {
    const out = `${outputDir}${stem}-p${index + 1}.${format}`;
    await renderPdfPage(path, index, dpi, format, quality, out);
    files.push(out);
    if (onPage) onPage(index + 1, total);
  }
  return files;
}
