import {
  FAILURE_CHECK,
  SLOT_NAMES,
  type AssetRecord,
  type CompleteContentSlots,
  type DesignConfig,
  type Failure,
  type FailureCode,
  type SlotLayout,
  type SlotName,
} from "./contracts.js";
import type { Measurement, Rect } from "./measurement.js";
import { inkRatio, type DecodedPng } from "./raster.js";
import type { SecurityEvents } from "./renderer.js";

/** Everything the browser produced for one render, plus what it was supposed to show. */
export interface RenderEvidence {
  config: DesignConfig;
  approved: CompleteContentSlots;
  brandName: string;
  measurement: Measurement;
  png: DecodedPng;
  security: SecurityEvents;
  servedAssets: ReadonlySet<string>;
  assets: readonly AssetRecord[];
}

export interface RenderValidation {
  failures: Failure[];
  layout: Partial<Record<SlotName, SlotLayout>>;
  assets: AssetRecord[];
  canvasActual: { width: number; height: number };
}

export const OVERFLOW_CODE = {
  brand: "BRAND_OVERFLOW",
  title: "TITLE_OVERFLOW",
  body: "BODY_OVERFLOW",
  source_note: "SOURCE_NOTE_OVERFLOW",
} as const satisfies Record<SlotName, FailureCode>;

export function failure(code: FailureCode, message: string, slot?: SlotName, details?: Record<string, unknown>): Failure {
  return {
    code,
    check: FAILURE_CHECK[code],
    ...(slot ? { slot } : {}),
    message,
    ...(details ? { details } : {}),
  };
}

/** Turns the rendered evidence into visual-validation failures. Pure: no I/O, no browser. */
export function validateRender(evidence: RenderEvidence): RenderValidation {
  const failures: Failure[] = [];
  const { config, measurement, png } = evidence;
  const tolerance = config.validation.overflow_tolerance_px;
  const scale = config.canvas.device_scale_factor;

  // ── assets ──
  const fontLoaded = new Map<string, boolean>();
  for (const font of measurement.fonts) {
    const spec = config.design_foundation.fonts.find((f) => f.family === font.family && f.weight === font.weight && f.style === font.style);
    if (spec) fontLoaded.set(spec.file, (fontLoaded.get(spec.file) ?? true) && font.loaded);
    if (!font.loaded) {
      failures.push(failure("ASSET_NOT_LOADED", `Font "${font.family}" ${font.weight} did not load`, undefined, { family: font.family, weight: font.weight, style: font.style }));
    }
  }
  const logo = measurement.slots.brand.image;
  const logoLoaded = logo !== null && logo.complete && logo.natural_width > 0;
  if (!logoLoaded) failures.push(failure("ASSET_NOT_LOADED", "Brand logo did not load", "brand"));

  const assets = evidence.assets.map((record): AssetRecord => {
    const served = evidence.servedAssets.has(`/${record.path}`);
    const loaded =
      record.role === "template" ? true
      : record.role === "logo" ? logoLoaded
      : record.role === "font" ? (fontLoaded.get(record.path) ?? served)
      : served;
    if (!loaded && (record.role === "design-stylesheet" || record.role === "template-stylesheet")) {
      failures.push(failure("ASSET_NOT_LOADED", `Stylesheet ${record.path} was not loaded`, undefined, { path: record.path }));
    }
    return { ...record, loaded };
  });

  for (const url of evidence.security.blocked_requests) {
    failures.push(failure("UNEXPECTED_ASSET_REQUEST", `Blocked a request outside the asset allowlist: ${url}`, undefined, { url }));
  }
  for (const violation of evidence.security.csp_violations.filter(isLoadViolation)) {
    failures.push(failure("UNEXPECTED_ASSET_REQUEST", "Content Security Policy blocked a resource load", undefined, { violation }));
  }

  // ── canvas ──
  const expected = { width: config.canvas.width * scale, height: config.canvas.height * scale };
  const canvasActual = { width: png.width, height: png.height };
  if (png.width !== expected.width || png.height !== expected.height) {
    failures.push(failure("CANVAS_SIZE_MISMATCH", `PNG is ${png.width}x${png.height}, expected ${expected.width}x${expected.height}`, undefined, { source: "png", expected, actual: canvasActual }));
  }
  const canvasRect = measurement.canvas.rect;
  if (measurement.canvas.count !== 1 || !canvasRect) {
    failures.push(failure("CANVAS_SIZE_MISMATCH", `Template must contain exactly one [data-canvas] element, found ${measurement.canvas.count}`, undefined, { source: "dom" }));
  } else {
    if (Math.abs(canvasRect.width - config.canvas.width) > 0.5 || Math.abs(canvasRect.height - config.canvas.height) > 0.5) {
      failures.push(failure("CANVAS_SIZE_MISMATCH", `Canvas element is ${canvasRect.width}x${canvasRect.height}, expected ${config.canvas.width}x${config.canvas.height}`, undefined, { source: "dom", actual: { width: canvasRect.width, height: canvasRect.height } }));
    }
    if (Math.abs(canvasRect.x) > 0.5 || Math.abs(canvasRect.y) > 0.5) {
      failures.push(failure("CANVAS_POSITION_MISMATCH", `Canvas element starts at (${canvasRect.x}, ${canvasRect.y}) instead of the top-left corner of the capture`, undefined, { x: canvasRect.x, y: canvasRect.y }));
    }
  }
  // Slots are checked against what the screenshot actually captures, not against
  // wherever the canvas element ended up.
  const bounds: Rect = { x: 0, y: 0, width: config.canvas.width, height: config.canvas.height };

  // ── content_present, overflow, approved_text_preserved, safe_binding (per slot) ──
  const layout: Partial<Record<SlotName, SlotLayout>> = {};
  for (const slot of SLOT_NAMES) {
    const m = measurement.slots[slot];
    if (m.count !== 1 || !m.rect) {
      failures.push(failure("SLOT_NOT_RENDERED", `Expected one [data-slot="${slot}"] element, found ${m.count}`, slot, { count: m.count }));
      continue;
    }
    if (!m.region_rect) {
      failures.push(failure("SLOT_NOT_RENDERED", `[data-slot="${slot}"] is not inside a [data-region] element`, slot));
      continue;
    }
    if (!m.visible || m.rect.width === 0 || m.rect.height === 0) {
      failures.push(failure("SLOT_NOT_RENDERED", `${label(slot)} is hidden or has no size`, slot, { visible: m.visible, rect: m.rect }));
    }

    const visiblePart = intersect(m.rect, bounds);
    const ink = visiblePart ? inkRatio(png, visiblePart, m.background_color, scale) : 0;
    if (ink !== null && ink < config.validation.min_ink_ratio) {
      failures.push(failure("CONTENT_NOT_PAINTED", `${label(slot)} is in the document but almost nothing was painted`, slot, { ink_ratio: ink, min_ink_ratio: config.validation.min_ink_ratio }));
    }

    // The full extent of the slot's content. It is larger than the slot's own box when the
    // template fixes the slot's height or the text runs out of it sideways. At tight line
    // heights, scroll_height can also exceed the box by a few pixels, because ascenders and
    // descenders reach past the line box. That is not overflow: hidden or spilled text
    // shows up as at least half a line. Smaller clipping is still caught by clipped_by.
    const excessHeight = m.scroll_height - m.client_height;
    const content: Rect = {
      x: m.rect.x,
      y: m.rect.y,
      width: Math.max(m.rect.width, m.scroll_width),
      height: excessHeight > Math.max(tolerance, (m.line_height_px ?? 0) / 2) ? m.rect.height + excessHeight : m.rect.height,
    };
    const lines = slot !== "brand" && m.line_height_px ? Math.round(content.height / m.line_height_px) : null;
    const maxLines = maxLinesFor(config, slot);
    const region = slot === "brand" ? inset(m.region_rect, config.layout.logo_clear_space_px.value) : m.region_rect;
    const overflowBottom = round(edge(content, "bottom") - edge(region, "bottom"));
    const overflowRight = round(edge(content, "right") - edge(region, "right"));
    layout[slot] = {
      lines,
      max_lines: maxLines,
      content_box: content,
      region_box: region,
      overflow_bottom_px: overflowBottom,
      overflow_right_px: overflowRight,
      ink_ratio: ink,
    };

    const reasons: string[] = [];
    if (overflowBottom > tolerance) reasons.push(`${overflowBottom}px taller than its region`);
    if (overflowRight > tolerance) reasons.push(`${overflowRight}px wider than its region`);
    if (edge(content, "top") < edge(region, "top") - tolerance || edge(content, "left") < edge(region, "left") - tolerance) {
      reasons.push("starts outside its region");
    }
    if (lines !== null && maxLines !== null && lines > maxLines) reasons.push(`${lines} lines where at most ${maxLines} fit`);
    if (!within(content, bounds, tolerance)) reasons.push("extends past the canvas edge");
    if (reasons.length > 0) {
      const what = slot === "brand" ? "Logo does not fit inside its clear space" : `${label(slot)} overflows its region`;
      failures.push(failure(OVERFLOW_CODE[slot], `${what}: ${reasons.join("; ")}`, slot, { lines, max_lines: maxLines, overflow_bottom_px: overflowBottom, overflow_right_px: overflowRight }));
    }
    if (m.clipped_by.length > 0) {
      failures.push(failure("TEXT_CLIPPED", `${label(slot)} is cut off by ${m.clipped_by.join(", ")}`, slot, { clipped_by: m.clipped_by }));
    }

    const expectedText = slot === "brand" ? evidence.brandName : evidence.approved[slot];
    if (m.text !== expectedText) {
      failures.push(failure("APPROVED_TEXT_CHANGED", `Rendered ${label(slot).toLowerCase()} differs from the approved text`, slot, describeDifference(expectedText, m.text ?? "")));
    }

    if (slot === "brand" || !m.styles) continue;
    const styles = m.styles;
    if (styles.text_overflow !== "clip" || styles.line_clamp !== "none") {
      failures.push(failure("TEXT_CLIPPED", `${label(slot)} is styled to truncate text`, slot, { text_overflow: styles.text_overflow, line_clamp: styles.line_clamp }));
    }
    // Styles that make the painted text read differently from the approved text.
    const altering: Array<[string, string, boolean]> = [
      ["text-transform", styles.text_transform, styles.text_transform !== "none"],
      // Pseudo-elements inherit the element's own transform; only a different one is a separate cause.
      ["::first-line text-transform", styles.first_line_text_transform, styles.first_line_text_transform !== styles.text_transform],
      ["::first-letter text-transform", styles.first_letter_text_transform, styles.first_letter_text_transform !== styles.text_transform],
      ["font-variant-caps", styles.font_variant_caps, styles.font_variant_caps !== "normal"],
      ["direction", styles.direction, styles.direction !== "ltr"],
      ["unicode-bidi", styles.unicode_bidi, styles.unicode_bidi.endsWith("override")],
      ["-webkit-text-security", styles.text_security, styles.text_security !== "none"],
    ];
    for (const [property, value, alters] of altering) {
      if (alters) {
        failures.push(failure("TEXT_ALTERED_BY_STYLE", `${label(slot)} is displayed with ${property}: ${value}`, slot, { property, value }));
      }
    }
    for (const [pseudo, content] of [["::before", styles.before_content], ["::after", styles.after_content]] as const) {
      if (content !== "none" && content !== "normal") {
        failures.push(failure("TEXT_ALTERED_BY_STYLE", `${label(slot)} has generated ${pseudo} content not in the approved text`, slot, { property: `${pseudo} content`, value: content }));
      }
    }
    if (m.child_elements > 0) {
      failures.push(failure("UNSAFE_MARKUP", `${label(slot)} contains ${m.child_elements} element(s); slots must hold text only`, slot, { child_elements: m.child_elements }));
    }
  }

  // ── safe_binding (document-wide) ──
  const doc = measurement.document;
  if (doc.script_elements > 0) {
    failures.push(failure("UNSAFE_MARKUP", `Rendered document contains ${doc.script_elements} <script> element(s)`, undefined, { script_elements: doc.script_elements }));
  }
  if (doc.event_handler_attributes > 0) {
    failures.push(failure("UNSAFE_MARKUP", `Rendered document contains ${doc.event_handler_attributes} inline event handler attribute(s)`, undefined, { event_handler_attributes: doc.event_handler_attributes }));
  }
  if (!doc.skeleton.matches) {
    failures.push(failure("UNSAFE_MARKUP", "Rendered element structure differs from the template; content was bound as markup", undefined, { ...doc.skeleton }));
  }
  for (const violation of evidence.security.csp_violations.filter((v) => !isLoadViolation(v))) {
    failures.push(failure("UNSAFE_MARKUP", "Content Security Policy blocked inline markup behaviour", undefined, { violation }));
  }
  if (evidence.security.dialogs > 0 || evidence.security.page_errors.length > 0) {
    failures.push(failure("SCRIPT_ACTIVITY", "Script activity was observed in the rendered page", undefined, { dialogs: evidence.security.dialogs, page_errors: evidence.security.page_errors }));
  }

  return { failures, layout, assets, canvasActual };
}

function isLoadViolation(message: string): boolean {
  return /^(Refused to load|Loading the)/.test(message);
}

function maxLinesFor(config: DesignConfig, slot: SlotName): number | null {
  if (slot === "title") return config.layout.title_max_lines.value;
  if (slot === "source_note") return config.layout.source_note_max_lines.value;
  return null;
}

const LABELS: Record<SlotName, string> = { brand: "Brand", title: "Title", body: "Body", source_note: "Source note" };
function label(slot: SlotName): string {
  return LABELS[slot];
}

function edge(rect: Rect, side: "top" | "left" | "bottom" | "right"): number {
  if (side === "top") return rect.y;
  if (side === "left") return rect.x;
  if (side === "bottom") return rect.y + rect.height;
  return rect.x + rect.width;
}

function within(inner: Rect, outer: Rect, tolerance: number): boolean {
  return (
    edge(inner, "left") >= edge(outer, "left") - tolerance &&
    edge(inner, "top") >= edge(outer, "top") - tolerance &&
    edge(inner, "right") <= edge(outer, "right") + tolerance &&
    edge(inner, "bottom") <= edge(outer, "bottom") + tolerance
  );
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(edge(a, "right"), edge(b, "right"));
  const bottom = Math.min(edge(a, "bottom"), edge(b, "bottom"));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, width: Math.max(0, rect.width - 2 * by), height: Math.max(0, rect.height - 2 * by) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Where two strings first differ, with a little context, so a reviewer can see what changed. */
export function describeDifference(expected: string, actual: string): Record<string, unknown> {
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) index++;
  const from = Math.max(0, index - 20);
  return {
    expected_length: expected.length,
    actual_length: actual.length,
    first_difference_at: index,
    expected_excerpt: expected.slice(from, index + 20),
    actual_excerpt: actual.slice(from, index + 20),
  };
}
