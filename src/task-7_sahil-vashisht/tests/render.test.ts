/**
 * End-to-end tests through a real headless Chromium: fixture -> bound HTML -> browser -> PNG + report.
 * Organised by the required checks in the Task 7 brief.
 */
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_NAMES, type FailureCode } from "../src/contracts.js";
import { SUBMISSION_DIR } from "../src/paths.js";
import { loadDesignConfig, readContentFile, renderInsight, type LoadedConfig, type RenderInsightOptions } from "../src/pipeline.js";
import { ChromiumRenderer } from "../src/renderer.js";
import { FIXTURES, fixture, inline, readPng, rewritingBinder, tempDir, templateVariant, unescapedBinder } from "./helpers.js";

let renderer: ChromiumRenderer;
let design: LoadedConfig;

beforeAll(async () => {
  renderer = await ChromiumRenderer.launch();
  design = await loadDesignConfig();
});
afterAll(async () => {
  await renderer?.close();
});

async function renderFixture(name: string, options: Partial<RenderInsightOptions> = {}) {
  const outDir = await tempDir(`insight-${name}-`);
  const outcome = await renderInsight(await readContentFile(path.join(FIXTURES, `${name}.json`)), { design, renderer, outDir, ...options });
  return { ...outcome, outDir };
}

async function renderContent(raw: unknown, options: Partial<RenderInsightOptions> = {}) {
  const outDir = await tempDir();
  const outcome = await renderInsight(inline(raw), { design, renderer, outDir, ...options });
  return { ...outcome, outDir };
}

const codes = (failures: Array<{ code: FailureCode }>) => failures.map((f) => f.code);
const exists = (file: string) => access(file).then(() => true, () => false);

describe("1. normal content", () => {
  it("renders the expected 1200x627 PNG and a passing report", async () => {
    const { report, files, outDir } = await renderFixture("normal");

    expect(report.status).toBe("pass");
    expect(report.failures).toEqual([]);
    for (const check of CHECK_NAMES) expect(report.checks[check], check).toBe("pass");
    expect(report.canvas).toEqual({ expected: { width: 1200, height: 627 }, actual: { width: 1200, height: 627 } });

    expect(files.png).toBe(path.join(outDir, "insight.png"));
    const png = await readPng(files.png!);
    expect([png.width, png.height]).toEqual([1200, 627]);
    expect(report.outputs.png_sha256).toMatch(/^[a-f0-9]{64}$/);

    // Every slot was painted, and every required asset actually loaded in the browser.
    for (const slot of ["brand", "title", "body", "source_note"] as const) {
      expect(report.layout[slot]!.ink_ratio, slot).toBeGreaterThan(0.01);
    }
    expect(report.assets.every((a) => a.loaded === true)).toBe(true);
    expect(report.security).toEqual({ page_javascript_enabled: false, blocked_requests: [], csp_violations: [], dialogs: 0, page_errors: [] });
  });

  it("is deterministic: the same input renders pixel-identical output and identical layout", async () => {
    const first = await renderFixture("normal");
    const second = await renderFixture("normal");
    const [a, b] = await Promise.all([readPng(first.files.png!), readPng(second.files.png!)]);
    expect(Buffer.compare(a.data, b.data)).toBe(0);
    expect(second.report.layout).toEqual(first.report.layout);
    expect(second.report.outputs.png_sha256).toBe(first.report.outputs.png_sha256);
  });

  it("saves an accessible HTML representation that stands on its own", async () => {
    const { files } = await renderFixture("normal");
    const html = await readFile(files.html!, "utf8");
    const normal = await fixture("normal");
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toContain(`<h1 class="insight__title" id="insight-title" data-slot="title">${normal.content.title}</h1>`);
    expect(html).toMatch(/<article class="insight" data-canvas aria-labelledby="insight-title">/);
    expect(html).toMatch(/<img class="insight__logo" data-slot="brand" src="[^"]+atomity_logo\.svg" alt="Atomity">/);
    expect(html).toMatch(/<base href="[^"]*template\/">/);
  });
});

describe("2. long title", () => {
  it("is reported as TITLE_OVERFLOW instead of producing a passing visual", async () => {
    const { report, outDir } = await renderFixture("long-title");
    expect(report.status).toBe("fail");
    expect(codes(report.failures)).toEqual(["TITLE_OVERFLOW"]);
    expect(report.layout.title).toMatchObject({ max_lines: 3 });
    expect(report.layout.title!.lines).toBeGreaterThan(3);
    // Nothing else is blamed: assets, canvas, text preservation and binding all still pass.
    expect(report.checks).toMatchObject({ overflow: "fail", assets: "pass", canvas: "pass", approved_text_preserved: "pass", safe_binding: "pass" });
    expect(await exists(path.join(outDir, "insight.png"))).toBe(false);
    expect(await exists(path.join(outDir, "insight.failed.png"))).toBe(true);
  });
});

describe("3. long body", () => {
  it("is reported as BODY_OVERFLOW, and the approved text is neither clipped nor hidden", async () => {
    const { report } = await renderFixture("long-body");
    expect(codes(report.failures)).toEqual(["BODY_OVERFLOW"]);
    expect(report.layout.body!.overflow_bottom_px).toBeGreaterThan(0);
    // The full body is still in the document, unmodified and unclipped: only the layout failed.
    expect(report.checks.approved_text_preserved).toBe("pass");
    expect(report.failures.some((f) => f.code === "TEXT_CLIPPED")).toBe(false);
  });
});

// 4. Missing required fields never reach the browser: see tests/pipeline.test.ts.

describe("5. HTML and script-like input", () => {
  it("is shown as literal text: nothing executes, nothing is requested, the structure is unchanged", async () => {
    const { report, files } = await renderFixture("html-script-input");
    expect(report.status).toBe("pass");
    expect(report.security).toEqual({ page_javascript_enabled: false, blocked_requests: [], csp_violations: [], dialogs: 0, page_errors: [] });

    const html = await readFile(files.html!, "utf8");
    expect(html).toContain("&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;");
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<img [^>]*onerror/i);
    expect(html).not.toContain('<link rel="stylesheet" href="https://evil.invalid');
  });

  it("would be caught by the validator even if escaping were broken (negative control)", async () => {
    const { report } = await renderFixture("html-script-input", { binder: unescapedBinder });
    expect(report.status).toBe("fail");
    expect(report.checks.safe_binding).toBe("fail");
    expect(codes(report.failures)).toEqual(expect.arrayContaining(["UNSAFE_MARKUP", "APPROVED_TEXT_CHANGED"]));
    // The injected script, image and stylesheet were all inert: JS was off and the CSP blocked the loads.
    expect(report.security!.dialogs).toBe(0);
    expect(report.security!.page_errors).toEqual([]);
    expect(codes(report.failures)).toContain("UNEXPECTED_ASSET_REQUEST");
  });

  it("keeps special characters byte for byte", async () => {
    const { report } = await renderFixture("special-characters");
    expect(report.status).toBe("pass");
    expect(report.checks.approved_text_preserved).toBe("pass");
  });
});

describe("6. changed approved text", () => {
  it("detects a renderer that rewrites a number in the approved body", async () => {
    const { report } = await renderFixture("normal", { binder: rewritingBinder });
    expect(report.status).toBe("fail");
    expect(report.failures).toEqual([
      expect.objectContaining({
        code: "APPROVED_TEXT_CHANGED",
        check: "approved_text_preserved",
        slot: "body",
        details: expect.objectContaining({ expected_excerpt: expect.stringContaining("42 managed"), actual_excerpt: expect.stringContaining("47 managed") }),
      }),
    ]);
  });

  it("detects a template that changes how approved text reads (text-transform)", async () => {
    const variant = await templateVariant("uppercase-title", {
      css: (css) => css.replace(".insight__title {", ".insight__title {\n  text-transform: uppercase !important;"),
    });
    const { report } = await renderFixture("normal", { design: variant });
    expect(report.failures).toEqual([expect.objectContaining({ code: "TEXT_ALTERED_BY_STYLE", slot: "title" })]);
  });

  it("detects generated text added around an approved slot", async () => {
    const variant = await templateVariant("generated-prefix", {
      css: (css) => `${css}\n.insight__source-note::before { content: "Verified: "; }\n`,
    });
    const { report } = await renderFixture("normal", { design: variant });
    expect(report.failures).toEqual([expect.objectContaining({ code: "TEXT_ALTERED_BY_STYLE", slot: "source_note" })]);
  });

  it("detects a template that truncates text with an ellipsis", async () => {
    const variant = await templateVariant("ellipsis-body", {
      css: (css) => `${css}\n.insight__body { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n`,
    });
    const { report } = await renderFixture("normal", { design: variant });
    expect(codes(report.failures)).toContain("TEXT_CLIPPED");
  });
});

// Regression cases from the independent review: each of these template edits once
// produced a "pass" even though approved text was hidden, cut off or misread.
describe("templates that hide or misrepresent approved text", () => {
  it.each([
    ["the slot itself hiding its overflow", ".insight__body { max-height: 40px; overflow: hidden; }", ["TEXT_CLIPPED"]],
    ["a fixed slot height letting text spill out", ".insight__title { height: 52px; }", ["TITLE_OVERFLOW"]],
    ["a clip-path over the slot", ".insight__body { clip-path: inset(0 0 60% 0); }", ["TEXT_CLIPPED"]],
    ["a canvas pushed out of the capture area", ".insight { margin-left: 80px; }", ["CANVAS_POSITION_MISMATCH", "BRAND_OVERFLOW"]],
    ["a bidi override", ".insight__body { unicode-bidi: bidi-override; direction: rtl; }", ["TEXT_ALTERED_BY_STYLE"]],
    ["text security discs", ".insight__body { -webkit-text-security: disc; }", ["TEXT_ALTERED_BY_STYLE"]],
    ["small caps", ".insight__title { font-variant-caps: all-small-caps; }", ["TEXT_ALTERED_BY_STYLE"]],
    ["an uppercase first line", ".insight__body::first-line { text-transform: uppercase; }", ["TEXT_ALTERED_BY_STYLE"]],
  ])("fails for %s", async (label, rule, expected) => {
    const variant = await templateVariant(label.replace(/\W+/g, "-"), { css: (css) => `${css}\n${rule}\n` });
    const { report } = await renderFixture("normal", { design: variant });
    expect(report.status).toBe("fail");
    expect(codes(report.failures)).toEqual(expect.arrayContaining(expected));
  });
});

describe("assets and security boundary", () => {
  it("blocks and reports a template reference outside the asset allowlist", async () => {
    const variant = await templateVariant("extra-image", {
      html: (html) => html.replace("</footer>", '<img src="../../../../README.md" alt="">\n      </footer>'),
    });
    const { report } = await renderFixture("normal", { design: variant });
    expect(report.failures).toContainEqual(expect.objectContaining({ code: "UNEXPECTED_ASSET_REQUEST", details: { url: expect.stringMatching(/README\.md$/) } }));
  });

  it("blocks and reports a remote stylesheet", async () => {
    const variant = await templateVariant("remote-css", {
      html: (html) => html.replace("</head>", '  <link rel="stylesheet" href="https://cdn.invalid/brand.css">\n</head>'),
    });
    const { report } = await renderFixture("normal", { design: variant });
    expect(report.failures).toContainEqual(expect.objectContaining({ code: "UNEXPECTED_ASSET_REQUEST" }));
  });

  it("reports a logo that is too wide for its clear space instead of squashing it", async () => {
    const narrow = structuredClone(design);
    narrow.config.layout.brand_panel_width_px.value = 200;
    const { report } = await renderFixture("normal", { design: narrow });
    expect(codes(report.failures)).toContain("BRAND_OVERFLOW");
  });
});

describe("reusable template", () => {
  it("renders any approved content through the same template without per-content HTML", async () => {
    const content = await fixture("normal");
    content.content_id = "insight-reuse";
    content.content.title = "Same template, new text";
    content.content.body = "Short body.";
    content.content.source_note = "Synthetic.";
    const { approvalDigest } = await import("../src/approval.js");
    content.approval.content_sha256 = approvalDigest(content.content);
    const { report } = await renderContent(content);
    expect(report.status).toBe("pass");
    expect(report.layout.title!.lines).toBe(1);
  });
});

describe("CLI", () => {
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: SUBMISSION_DIR }).then(
      ({ stdout }) => ({ code: 0, stdout }),
      (error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }),
    );

  it("exits 0 for a passing render, 1 for a validation failure and 2 for a usage error", async () => {
    const out = await tempDir();
    const pass = await run("fixtures/normal.json", "--out", path.join(out, "a"));
    const fail = await run("fixtures/long-title.json", "--out", path.join(out, "b"));
    const usage = await run();
    expect(pass).toMatchObject({ code: 0, stdout: expect.stringContaining("insight-normal → PASS") });
    expect(fail).toMatchObject({ code: 1, stdout: expect.stringContaining("TITLE_OVERFLOW") });
    expect(usage.code).toBe(2);
  });
});
