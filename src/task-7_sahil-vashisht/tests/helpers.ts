import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { safeBinder, type TemplateBinder } from "../src/binder.js";
import { SLOT_NAMES, type CompleteContentSlots, type SlotName } from "../src/contracts.js";
import type { Measurement, Rect, SlotMeasurement } from "../src/measurement.js";
import { SUBMISSION_DIR, resolveRepoPath, toRepoRelative } from "../src/paths.js";
import { loadDesignConfig, type ContentInput, type LoadedConfig } from "../src/pipeline.js";
import { decodePng, type DecodedPng } from "../src/raster.js";
import type { Renderer } from "../src/renderer.js";
import type { RenderEvidence } from "../src/validate.js";

export const FIXTURES = path.join(SUBMISSION_DIR, "fixtures");

export async function fixture(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path.join(FIXTURES, `${name}.json`), "utf8"));
}

/** Content input built in memory, for variants of the supplied fixtures. */
export function inline(raw: unknown): ContentInput {
  return { raw, file: null, sha256: null };
}

export function tempDir(prefix = "insight-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

/** A renderer that fails the test if the pipeline ever reaches the browser. */
export const neverRender: Renderer = {
  render: () => {
    throw new Error("The pipeline must not render this content");
  },
  close: async () => {},
};

/** Deliberately broken: substitutes raw values with no escaping. Used to prove the validator catches injection. */
export const unescapedBinder: TemplateBinder = {
  bind: (template, values) => template.replace(/\{\{\s*(@?[a-z][a-z0-9_]*)\s*\}\}/g, (token, name: string) => values[name] ?? token),
};

/** Deliberately broken: "tidies" a number in the body before binding, as a careless renderer might. */
export const rewritingBinder: TemplateBinder = {
  bind: (template, values) => safeBinder.bind(template, { ...values, body: values.body!.replace("42", "47") }),
};

/**
 * Writes a modified copy of the template (and its stylesheet) under out/test-templates/<name>/
 * and returns a design configuration that points at it. The real template is never touched.
 */
export async function templateVariant(
  name: string,
  edit: { html?: (html: string) => string; css?: (css: string) => string },
): Promise<LoadedConfig> {
  const base = await loadDesignConfig();
  const dir = path.join(SUBMISSION_DIR, "out", "test-templates", name);
  await mkdir(dir, { recursive: true });

  const designCss = path.posix.relative(toRepoRelative(dir), base.config.design_foundation.stylesheet);
  let html = await readFile(resolveRepoPath(base.config.template.html), "utf8");
  html = html.replace('href="../../../design/atomity.css"', `href="${designCss}"`);
  let css = await readFile(resolveRepoPath(base.config.template.stylesheet), "utf8");
  if (edit.html) html = edit.html(html);
  if (edit.css) css = edit.css(css);
  await writeFile(path.join(dir, "single-insight-v1.html"), html);
  await writeFile(path.join(dir, "single-insight-v1.css"), css);

  const config = structuredClone(base.config);
  config.template.html = toRepoRelative(path.join(dir, "single-insight-v1.html"));
  config.template.stylesheet = toRepoRelative(path.join(dir, "single-insight-v1.css"));
  return { ...base, config };
}

export async function readPng(file: string): Promise<DecodedPng> {
  return decodePng(await readFile(file));
}

// ─── Synthetic evidence for browser-free validator tests ──────────────────────

export const APPROVED: CompleteContentSlots = {
  brand: "atomity",
  title: "A new sovereign region changes where regulated workloads can run",
  body: "Fictional Provider A opened a region with 42 managed services.",
  source_note: "Fictional Provider A press release, 3 Oct 2026.",
};

const CREAM = "rgb(246, 244, 236)";
const MINT = "rgb(151, 221, 177)";

const SLOT_BOXES: Record<SlotName, { rect: Rect; region: Rect; lineHeight: number | null }> = {
  brand: { rect: { x: 932, y: 563, width: 222, height: 32 }, region: { x: 900, y: 0, width: 300, height: 627 }, lineHeight: null },
  title: { rect: { x: 48, y: 48, width: 804, height: 104 }, region: { x: 48, y: 48, width: 804, height: 104 }, lineHeight: 52 },
  body: { rect: { x: 48, y: 176, width: 804, height: 204 }, region: { x: 48, y: 176, width: 804, height: 312 }, lineHeight: 34 },
  source_note: { rect: { x: 48, y: 557, width: 804, height: 22 }, region: { x: 48, y: 557, width: 804, height: 44 }, lineHeight: 22 },
};

function slotMeasurement(slot: SlotName): SlotMeasurement {
  const { rect, region, lineHeight } = SLOT_BOXES[slot];
  return {
    count: 1,
    tag: slot === "brand" ? "img" : slot === "title" ? "h1" : "p",
    text: slot === "brand" ? "Atomity" : APPROVED[slot],
    child_elements: 0,
    rect,
    region_rect: region,
    scroll_width: rect.width,
    client_width: rect.width,
    scroll_height: rect.height,
    client_height: rect.height,
    line_height_px: lineHeight,
    visible: true,
    background_color: slot === "brand" ? MINT : CREAM,
    styles:
      slot === "brand"
        ? null
        : {
            display: "block", visibility: "visible", opacity: 1, color: "rgb(3, 3, 3)",
            font_family: '"Google Sans Flex"', font_size_px: 46, text_transform: "none",
            first_line_text_transform: "none", first_letter_text_transform: "none", font_variant_caps: "normal",
            direction: "ltr", unicode_bidi: "isolate", text_security: "none",
            text_overflow: "clip", line_clamp: "none", overflow_x: "visible", overflow_y: "visible",
            before_content: "normal", after_content: "normal",
          },
    clipped_by: [],
    image: slot === "brand" ? { complete: true, natural_width: 319, natural_height: 46, src: "/design/atomity_logo.svg" } : null,
  };
}

export function passingMeasurement(): Measurement {
  return {
    url_path: "/src/task-7_sahil-vashisht/template/single-insight-v1.html",
    viewport: { width: 1200, height: 627 },
    canvas: { count: 1, rect: { x: 0, y: 0, width: 1200, height: 627 }, background_color: CREAM },
    fonts: [
      { family: "Google Sans Flex", weight: 700, style: "normal", loaded: true },
      { family: "Google Sans Flex", weight: 400, style: "normal", loaded: true },
      { family: "Google Sans Code", weight: 700, style: "normal", loaded: true },
      { family: "Gowun Batang", weight: 400, style: "normal", loaded: true },
    ],
    slots: Object.fromEntries(SLOT_NAMES.map((slot) => [slot, slotMeasurement(slot)])) as Measurement["slots"],
    document: {
      script_elements: 0,
      event_handler_attributes: 0,
      skeleton: { matches: true, expected_length: 20, actual_length: 20, first_difference: null },
    },
  };
}

/** A cream canvas with a mint panel and dark "ink" stripes inside each slot box, like a real render. */
export function syntheticPng(width = 1200, height = 627, paintSlots = true): DecodedPng {
  const png = new PNG({ width, height });
  const fill = (rect: Rect, [r, g, b]: [number, number, number], every = 1) => {
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y += every) {
      for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.width); x++) {
        const i = (y * width + x) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
      }
    }
  };
  fill({ x: 0, y: 0, width, height }, [246, 244, 236]);
  fill({ x: 900, y: 0, width: 300, height }, [151, 221, 177]);
  if (paintSlots) for (const { rect } of Object.values(SLOT_BOXES)) fill(rect, [3, 3, 3], 3);
  return { width, height, data: png.data };
}

export async function syntheticEvidence(): Promise<RenderEvidence> {
  const { config } = await loadDesignConfig();
  return {
    config,
    approved: { ...APPROVED },
    brandName: "Atomity",
    measurement: passingMeasurement(),
    png: syntheticPng(),
    security: { blocked_requests: [], csp_violations: [], dialogs: 0, page_errors: [] },
    servedAssets: new Set(["/design/atomity.css", `/${config.template.stylesheet}`, "/design/atomity_logo.svg"]),
    assets: [
      { role: "template", path: config.template.html, exists: true, sha256: "x", loaded: null },
      { role: "template-stylesheet", path: config.template.stylesheet, exists: true, sha256: "x", loaded: null },
      { role: "design-stylesheet", path: config.design_foundation.stylesheet, exists: true, sha256: "x", loaded: null },
    ],
  };
}

