// Manual crop box math. Rectangles are normalized to the picture (x, y, w, h between 0 and 1), so the same
// rectangle works for the on-screen preview and for the full-size file. Pure functions: unit and fuzz tested.
import { RATIOS } from "./ratios";

// Smallest side of the box, as a share of the picture, so it never collapses under a finger.
export const MIN_SIZE = 0.05;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Width-to-height ratio of a preset in normalized units, or null for a free box.
export function normalizedAspect(ratioKey, width, height) {
  const ratio = RATIOS[ratioKey];
  if (!ratio || !width || !height) return null;
  return ((ratio[0] / ratio[1]) * height) / width;
}

// The largest centered box with the preset's shape, or the whole picture for a free box.
export function initialRect(ratioKey, width, height) {
  const aspect = normalizedAspect(ratioKey, width, height);
  if (!aspect) return { x: 0, y: 0, w: 1, h: 1 };
  const w = aspect >= 1 ? 1 : aspect;
  const h = aspect >= 1 ? 1 / aspect : 1;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// Drags the whole box, stopping at the picture's edges.
export function moveRect(rect, dx, dy) {
  return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.w), y: clamp(rect.y + dy, 0, 1 - rect.h) };
}

// Drags one corner ("tl", "tr", "bl", "br") while the opposite corner stays put. With an aspect, the box
// keeps its shape: the width follows the finger and the height follows the width.
export function resizeRect(rect, corner, dx, dy, aspect = null) {
  const left = corner === "tl" || corner === "bl";
  const top = corner === "tl" || corner === "tr";
  const anchorX = left ? rect.x + rect.w : rect.x;
  const anchorY = top ? rect.y + rect.h : rect.y;
  const roomX = left ? anchorX : 1 - anchorX;
  const roomY = top ? anchorY : 1 - anchorY;

  let w = clamp(rect.w + (left ? -dx : dx), MIN_SIZE, roomX);
  let h = clamp(rect.h + (top ? -dy : dy), MIN_SIZE, roomY);
  if (aspect) {
    // Fit the shape inside the room on both axes, never below the minimum size.
    w = Math.min(w, roomX, roomY * aspect);
    h = w / aspect;
    if (h < MIN_SIZE) {
      h = Math.min(MIN_SIZE, roomY);
      w = Math.min(h * aspect, roomX);
      h = w / aspect;
    }
  }
  return { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, w, h };
}

// FFmpeg crop filter for a normalized box on a picture of the given size. Even sizes, inside the picture.
// Null when the box is the whole picture or too small to keep.
export function rectFilter(rect, width, height) {
  if (!rect || !width || !height) return null;
  let cropWidth = Math.round(clamp(rect.w, 0, 1) * width);
  let cropHeight = Math.round(clamp(rect.h, 0, 1) * height);
  cropWidth -= cropWidth % 2;
  cropHeight -= cropHeight % 2;
  if (cropWidth < 2 || cropHeight < 2) return null;
  const x = clamp(Math.round(rect.x * width), 0, width - cropWidth);
  const y = clamp(Math.round(rect.y * height), 0, height - cropHeight);
  if (cropWidth >= width - 1 && cropHeight >= height - 1) return null;
  return `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
}
