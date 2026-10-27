import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
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

// A new PDF with only the given 1-based pages, in order.
export async function extractPages(path, pages) {
  const source = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pages.map((page) => page - 1));
  copied.forEach((page) => out.addPage(page));
  return out.save();
}

// Turns pages clockwise by the given degrees, on top of any rotation they already had. `pages` lists
// 1-based page numbers; null turns every page.
export async function rotatePdf(path, angle, pages = null) {
  const pdf = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
  const chosen = pages ? new Set(pages) : null;
  pdf.getPages().forEach((page, index) => {
    if (chosen && !chosen.has(index + 1)) return;
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return pdf.save();
}

// Diagonal text across the middle of every page. The built-in font covers Latin text only, so other
// scripts are rejected before anything is drawn.
export async function watermarkPdf(path, text, opacity) {
  const pdf = await PDFDocument.load(await readBytes(path), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  font.encodeText(text);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / Math.max(4, text.length * 0.6);
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: width / 2 - (textWidth / 2) * Math.SQRT1_2,
      y: height / 2 - (textWidth / 2) * Math.SQRT1_2,
      size,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      rotate: degrees(45),
    });
  }
  return pdf.save();
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
