import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { approvalDigest, sha256 } from "./approval.js";
import { planAssets } from "./assets.js";
import { escapeHtml, safeBinder, type TemplateBinder } from "./binder.js";
import {
  ApprovedContentSchema,
  CHECK_NAMES,
  DesignConfigSchema,
  SLOT_NAMES,
  ValidationReportSchema,
  describeIssues,
  type ApprovedContent,
  type AssetRecord,
  type CheckName,
  type CheckStatus,
  type CompleteContentSlots,
  type DesignConfig,
  type Failure,
  type ValidationReport,
} from "./contracts.js";
import { DEFAULT_CONFIG_PATH, resolveRepoPath, toRepoRelative } from "./paths.js";
import { decodePng } from "./raster.js";
import type { Renderer } from "./renderer.js";
import { failure, validateRender } from "./validate.js";

export const OUTPUT_FILES = {
  report: "report.json",
  png: "insight.png",
  failedPng: "insight.failed.png",
  html: "insight.html",
} as const;

export class DesignConfigError extends Error {
  override name = "DesignConfigError";
}

export interface LoadedConfig {
  config: DesignConfig;
  file: string;
  sha256: string;
}

export interface RenderInsightOptions {
  design: LoadedConfig;
  renderer: Renderer;
  outDir: string;
  /** Defaults to the escaping binder. Tests inject faulty binders to prove the validator catches them. */
  binder?: TemplateBinder;
}

/** Raw approved-content input, before validation. */
export interface ContentInput {
  raw: unknown;
  /** Set when the file could not be parsed as JSON. */
  parseError?: string;
  file: string | null;
  sha256: string | null;
}

export interface RenderOutcome {
  report: ValidationReport;
  files: { report: string; png: string | null; html: string | null };
}

/** A broken design configuration is a deployment error, not a content failure, so it throws. */
export async function loadDesignConfig(file: string = DEFAULT_CONFIG_PATH): Promise<LoadedConfig> {
  const text = await readFile(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new DesignConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = DesignConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DesignConfigError(`Invalid design configuration ${file}:\n  ${describeIssues(parsed.error).join("\n  ")}`);
  }
  return { config: parsed.data, file, sha256: sha256(text) };
}

export async function readContentFile(file: string): Promise<ContentInput> {
  const bytes = await readFile(file);
  const input: ContentInput = { raw: null, file: toRepoRelative(path.resolve(file)), sha256: sha256(bytes) };
  try {
    input.raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    input.parseError = (error as Error).message;
  }
  return input;
}

/**
 * Approved content + design configuration -> bound HTML -> browser -> PNG + visual-validation report.
 *
 * Content that is invalid, incomplete, missing an asset or changed since approval is
 * never rendered. Its report says why. Content that renders but fails visual validation
 * keeps its PNG as insight.failed.png, for diagnosis, so it cannot be mistaken for a
 * deliverable. Only a passing render produces insight.png.
 */
export async function renderInsight(input: ContentInput, options: RenderInsightOptions): Promise<RenderOutcome> {
  const { config } = options.design;
  const binder = options.binder ?? safeBinder;
  const failures: Failure[] = [];
  const ran = new Set<CheckName>(["input_contract"]);

  // Outputs from a previous run are removed before anything can fail. An old insight.png
  // must never sit next to a report that now says "fail", or survive a crash.
  await mkdir(options.outDir, { recursive: true });
  await Promise.all(Object.values(OUTPUT_FILES).map((name) => rm(path.join(options.outDir, name), { force: true })));

  // 1. Input contract
  let content: ApprovedContent | null = null;
  if (input.parseError !== undefined) {
    failures.push(failure("INPUT_INVALID", `Content is not valid JSON: ${input.parseError}`));
  } else {
    const parsed = ApprovedContentSchema.safeParse(input.raw);
    if (parsed.success) content = parsed.data;
    else failures.push(failure("INPUT_INVALID", "Content does not match the approved-content contract", undefined, { issues: describeIssues(parsed.error) }));
  }

  // 2. Required fields: every slot present and non-blank; the brand must be one the design supplies.
  let slots: CompleteContentSlots | null = null;
  let brand: DesignConfig["brands"][string] | null = null;
  if (content) {
    ran.add("required_fields");
    const values = content.content;
    const missing = SLOT_NAMES.filter((slot) => (values[slot] ?? "").trim() === "");
    for (const slot of missing) {
      failures.push(failure("MISSING_REQUIRED_FIELD", `Required field "${slot}" is missing or blank`, slot, { field: slot, received: describeReceived(values[slot]) }));
    }
    if (!missing.includes("brand")) {
      brand = Object.hasOwn(config.brands, values.brand!) ? config.brands[values.brand!]! : null;
      if (!brand) {
        failures.push(failure("UNKNOWN_BRAND", `Brand "${values.brand}" is not defined in the design configuration`, "brand", { brand: values.brand, configured: Object.keys(config.brands) }));
      }
    }
    if (missing.length === 0 && brand) slots = values as CompleteContentSlots;
  }

  // 3. Asset preflight. Runs even for invalid content, so the report always says what the template needs.
  ran.add("assets");
  const plan = await planAssets(config, brand ? content!.content.brand! : null);
  for (const record of plan.missing) {
    failures.push(failure("ASSET_MISSING", `Required ${record.role} asset ${record.path} does not exist`, undefined, { path: record.path, role: record.role }));
  }
  let assets: AssetRecord[] = plan.records;

  // 4. The text about to be rendered must be the text that was approved.
  let digestComputed: string | null = null;
  if (content && slots) {
    ran.add("approved_text_preserved");
    digestComputed = approvalDigest(slots);
    if (digestComputed !== content.approval.content_sha256) {
      failures.push(failure("APPROVAL_DIGEST_MISMATCH", "Content has changed since it was approved: its digest does not match the approval record", undefined, {
        recorded: content.approval.content_sha256,
        computed: digestComputed,
      }));
    }
  }

  // 5. Bind, render and validate. Only reached by complete, approved content with every asset present.
  let png: Buffer | null = null;
  let html: string | null = null;
  let layout: ValidationReport["layout"] = {};
  let security: ValidationReport["security"] = null;
  let rendererInfo: ValidationReport["renderer"] = null;
  let canvasActual: ValidationReport["canvas"]["actual"] = null;

  if (failures.length === 0 && content && slots && brand) {
    const templateSource = await readFile(resolveRepoPath(config.template.html), "utf8");
    const configCss = designConfigCss(config);
    const csp = contentSecurityPolicy(configCss);
    html = binder.bind(templateSource, {
      title: slots.title,
      body: slots.body,
      source_note: slots.source_note,
      "@csp": csp,
      "@config_css": configCss,
      "@source_label": config.labels.source,
      "@brand_name": brand.name,
      "@brand_logo_src": path.posix.relative(path.posix.dirname(config.template.html), brand.logo),
    });

    const viewport = { width: config.canvas.width, height: config.canvas.height };
    const output = await options.renderer.render({
      pageUrlPath: `/${config.template.html}`,
      html,
      csp,
      allowlist: plan.allowlist,
      viewport,
      deviceScaleFactor: config.canvas.device_scale_factor,
      templateSource,
      measure: {
        slots: SLOT_NAMES,
        fonts: config.design_foundation.fonts.map(({ family, weight, style }) => ({ family, weight, style })),
      },
    });
    png = output.png;

    const validation = validateRender({
      config,
      approved: slots,
      brandName: brand.name,
      measurement: output.measurement,
      png: decodePng(output.png),
      security: output.security,
      servedAssets: output.servedAssets,
      assets: plan.records,
    });
    failures.push(...validation.failures);
    for (const check of ["canvas", "content_present", "overflow", "safe_binding"] as const) ran.add(check);
    assets = validation.assets;
    layout = validation.layout;
    canvasActual = validation.canvasActual;
    security = { page_javascript_enabled: false, ...output.security };
    rendererInfo = {
      engine: output.engine,
      browser_version: output.browserVersion,
      viewport,
      device_scale_factor: config.canvas.device_scale_factor,
    };
  }

  // 6. Report and outputs.
  const checks = Object.fromEntries(
    CHECK_NAMES.map((name): [CheckName, CheckStatus] => [
      name,
      failures.some((f) => f.check === name) ? "fail" : ran.has(name) ? "pass" : "skipped",
    ]),
  ) as ValidationReport["checks"];
  const status = failures.length === 0 ? "pass" : "fail";

  const pngName = png ? (status === "pass" ? OUTPUT_FILES.png : OUTPUT_FILES.failedPng) : null;
  if (png && pngName) await writeFile(path.join(options.outDir, pngName), png);
  if (html) await writeFile(path.join(options.outDir, OUTPUT_FILES.html), withBaseHref(html, options.outDir, config.template.html));

  const report = ValidationReportSchema.parse({
    report_version: "1.0",
    scope: "visual-validation",
    template: { id: config.template.id, version: config.template.version },
    content_id: content?.content_id ?? null,
    status,
    canvas: {
      expected: {
        width: config.canvas.width * config.canvas.device_scale_factor,
        height: config.canvas.height * config.canvas.device_scale_factor,
      },
      actual: canvasActual,
    },
    checks,
    failures,
    layout,
    security,
    assets,
    inputs: {
      content_file: input.file,
      content_file_sha256: input.sha256,
      approval_digest_recorded: content?.approval.content_sha256 ?? null,
      approval_digest_computed: digestComputed,
      design_config_file: toRepoRelative(options.design.file),
      design_config_sha256: options.design.sha256,
    },
    outputs: {
      png: pngName,
      png_sha256: png ? sha256(png) : null,
      html: html ? OUTPUT_FILES.html : null,
    },
    renderer: rendererInfo,
  } satisfies ValidationReport);

  const reportPath = path.join(options.outDir, OUTPUT_FILES.report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return {
    report,
    files: {
      report: reportPath,
      png: pngName ? path.join(options.outDir, pngName) : null,
      html: html ? path.join(options.outDir, OUTPUT_FILES.html) : null,
    },
  };
}

/**
 * The design-configuration values atomity.css does not define, as --insight-* custom
 * properties. Built only from schema-validated numbers, so it is safe in a <style> block.
 */
export function designConfigCss(config: DesignConfig): string {
  const layout = config.layout;
  const px = (n: number) => `${n}px`;
  const vars: Array<[string, string]> = [
    ["--insight-canvas-width", px(config.canvas.width)],
    ["--insight-canvas-height", px(config.canvas.height)],
    ["--insight-brand-panel-width", px(layout.brand_panel_width_px.value)],
    ["--insight-logo-height", px(layout.logo_height_px.value)],
    ["--insight-logo-clear-space", px(layout.logo_clear_space_px.value)],
    ["--insight-title-size", px(layout.title_font_size_px.value)],
    ["--insight-title-line-height", px(layout.title_line_height_px.value)],
    ["--insight-title-max-lines", String(layout.title_max_lines.value)],
    ["--insight-body-size", px(layout.body_font_size_px.value)],
    ["--insight-body-line-height", px(layout.body_line_height_px.value)],
    ["--insight-source-note-size", px(layout.source_note_font_size_px.value)],
    ["--insight-source-note-line-height", px(layout.source_note_line_height_px.value)],
    ["--insight-source-note-max-lines", String(layout.source_note_max_lines.value)],
    ["--insight-label-size", px(layout.label_font_size_px.value)],
  ];
  return `:root{${vars.map(([name, value]) => `${name}:${value}`).join(";")}}`;
}

/**
 * No script may run, and no style may apply except same-origin stylesheets and the one
 * configuration block (pinned by its hash). Images and fonts load from the render
 * origin only. data: images are allowed because atomity.css draws its grid texture
 * with an inline SVG mask.
 */
export function contentSecurityPolicy(configCss: string): string {
  const styleHash = createHash("sha256").update(configCss, "utf8").digest("base64");
  return [
    "default-src 'none'",
    `style-src 'self' 'sha256-${styleHash}'`,
    "font-src 'self'",
    "img-src 'self' data:",
    "script-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * The saved insight.html is the rendered document plus a <base> element, so its relative
 * links resolve to the template folder when it is opened from the output folder.
 */
function withBaseHref(html: string, outDir: string, templateRepoPath: string): string {
  const templateDir = path.dirname(resolveRepoPath(templateRepoPath));
  const relative = path.relative(path.resolve(outDir), templateDir);
  // On Windows an output folder on another drive has no relative path; fall back to a file URL.
  const href = path.isAbsolute(relative)
    ? `${pathToFileURL(templateDir).href}/`
    : relative === "" ? "./" : `${relative.split(path.sep).map(encodeURIComponent).join("/")}/`;
  return html.replace("<head>", `<head>\n  <base href="${escapeHtml(href)}">`);
}

function describeReceived(value: string | null | undefined): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  return value === "" ? "empty string" : "whitespace only";
}
