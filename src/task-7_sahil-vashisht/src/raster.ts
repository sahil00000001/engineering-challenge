import { PNG } from "pngjs";
import type { Rect } from "./measurement.js";

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Buffer;
}

export function decodePng(png: Buffer): DecodedPng {
  const decoded = PNG.sync.read(png);
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

/** Channel difference above which a pixel counts as painted rather than background. */
const INK_THRESHOLD = 40;

/**
 * Share of pixels inside `rect` (CSS pixels) that differ clearly from `background`.
 * It answers "was this slot actually painted?" and catches text that is in the DOM
 * but invisible, such as transparent colour, zero size or a missing font.
 */
export function inkRatio(png: DecodedPng, rect: Rect, background: string | null, scale: number): number | null {
  const bg = parseRgb(background);
  if (!bg) return null;
  const x0 = clamp(Math.floor(rect.x * scale), 0, png.width);
  const y0 = clamp(Math.floor(rect.y * scale), 0, png.height);
  const x1 = clamp(Math.ceil((rect.x + rect.width) * scale), 0, png.width);
  const y1 = clamp(Math.ceil((rect.y + rect.height) * scale), 0, png.height);
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return 0;

  let ink = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const diff = Math.max(
        Math.abs(png.data[i]! - bg[0]),
        Math.abs(png.data[i + 1]! - bg[1]),
        Math.abs(png.data[i + 2]! - bg[2]),
      );
      if (diff > INK_THRESHOLD) ink++;
    }
  }
  return Math.round((ink / area) * 10000) / 10000;
}

/** Parses the rgb()/rgba() strings returned by getComputedStyle. Alpha is ignored, because backgrounds here are opaque. */
export function parseRgb(color: string | null): [number, number, number] | null {
  const match = color?.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
