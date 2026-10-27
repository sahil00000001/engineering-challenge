/**
 * Pipeline routing without a browser. Content that is malformed, incomplete, changed since
 * approval or missing an asset must be reported and never rendered: the renderer used
 * here throws if it is ever called.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SLOT_NAMES } from "../src/contracts.js";
import { OUTPUT_FILES, loadDesignConfig, readContentFile, renderInsight, type LoadedConfig } from "../src/pipeline.js";
import { FIXTURES, fixture, inline, neverRender, tempDir } from "./helpers.js";

let design: LoadedConfig;
beforeAll(async () => {
  design = await loadDesignConfig();
});

async function route(raw: unknown) {
  const outDir = await tempDir();
  const outcome = await renderInsight(inline(raw), { design, renderer: neverRender, outDir });
  return { ...outcome, outDir };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}

describe("missing required fields", () => {
  const cases = SLOT_NAMES.flatMap((slot) =>
    (["absent", "null", "empty string", "whitespace only"] as const).map((received) => ({ slot, received })),
  );

  it.each(cases)("$slot $received gives MISSING_REQUIRED_FIELD and no render", async ({ slot, received }) => {
    const content = await fixture("normal");
    if (received === "absent") delete content.content[slot];
    else content.content[slot] = received === "null" ? null : received === "empty string" ? "" : " \n ";

    const { report, files } = await route(content);

    expect(report.status).toBe("fail");
    expect(report.failures).toEqual([
      expect.objectContaining({ code: "MISSING_REQUIRED_FIELD", check: "required_fields", slot, details: { field: slot, received } }),
    ]);
    expect(report.checks).toMatchObject({ input_contract: "pass", required_fields: "fail", overflow: "skipped", approved_text_preserved: "skipped" });
    expect(files.png).toBeNull();
    expect(report.outputs).toEqual({ png: null, png_sha256: null, html: null });
  });

  it("lists every missing field at once", async () => {
    const content = await fixture("normal");
    content.content.title = "";
    delete content.content.body;
    const { report } = await route(content);
    expect(report.failures.map((f) => f.slot)).toEqual(["title", "body"]);
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("treats the object key %j as an unknown brand, not a crash", async (brand) => {
    const content = await fixture("normal");
    content.content.brand = brand;
    const { report } = await route(content);
    expect(report.failures).toEqual([expect.objectContaining({ code: "UNKNOWN_BRAND", slot: "brand" })]);
  });

  it("reports a brand the design does not supply instead of inventing one", async () => {
    const content = await fixture("normal");
    content.content.brand = "acme-cloud";
    const { report } = await route(content);
    expect(report.failures).toEqual([
      expect.objectContaining({ code: "UNKNOWN_BRAND", slot: "brand", details: { brand: "acme-cloud", configured: ["atomity"] } }),
    ]);
  });
});

describe("malformed input", () => {
  it("reports every contract issue in the malformed fixture", async () => {
    const outDir = await tempDir();
    const { report } = await renderInsight(await readContentFile(path.join(FIXTURES, "malformed.json")), { design, renderer: neverRender, outDir });
    expect(report.content_id).toBeNull();
    expect(report.checks.input_contract).toBe("fail");
    expect(report.failures).toHaveLength(1);
    const issues = (report.failures[0]!.details as { issues: string[] }).issues;
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^content\.title: .*expected string, received number/),
        expect.stringMatching(/^content\.body: .*expected string, received array/),
        expect.stringMatching(/^content: Unrecognized key: "subtitle"/),
        expect.stringMatching(/^approval: /),
      ]),
    );
  });

  it("reports a file that is not JSON at all", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "broken.json");
    await writeFile(file, '{ "schema_version": "1.0", ');
    const { report } = await renderInsight(await readContentFile(file), { design, renderer: neverRender, outDir: dir });
    expect(report.failures).toEqual([expect.objectContaining({ code: "INPUT_INVALID", message: expect.stringMatching(/not valid JSON/) })]);
    expect(report.inputs.content_file_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([["an array", []], ["a string", "title"], ["null", null]])("reports %s as INPUT_INVALID", async (_label, raw) => {
    const { report } = await route(raw);
    expect(report.failures.map((f) => f.code)).toEqual(["INPUT_INVALID"]);
  });
});

describe("content changed after approval", () => {
  it("is refused before rendering, with both digests in the report", async () => {
    const outDir = await tempDir();
    const { report } = await renderInsight(await readContentFile(path.join(FIXTURES, "changed-after-approval.json")), { design, renderer: neverRender, outDir });
    expect(report.checks.approved_text_preserved).toBe("fail");
    expect(report.failures).toEqual([expect.objectContaining({ code: "APPROVAL_DIGEST_MISMATCH" })]);
    expect(report.inputs.approval_digest_recorded).not.toBe(report.inputs.approval_digest_computed);
  });

  it("detects a single changed character", async () => {
    const content = await fixture("normal");
    content.content.source_note = content.content.source_note.replace("3 Oct", "4 Oct");
    const { report } = await route(content);
    expect(report.failures.map((f) => f.code)).toEqual(["APPROVAL_DIGEST_MISMATCH"]);
  });
});

describe("assets", () => {
  it("reports a missing logo before rendering", async () => {
    const broken = structuredClone(design);
    broken.config.brands.atomity!.logo = "design/atomity_logo_missing.svg";
    const outDir = await tempDir();
    const { report } = await renderInsight(inline(await fixture("normal")), { design: broken, renderer: neverRender, outDir });
    expect(report.failures).toEqual([
      expect.objectContaining({ code: "ASSET_MISSING", check: "assets", details: { path: "design/atomity_logo_missing.svg", role: "logo" } }),
    ]);
    expect(report.assets.find((a) => a.role === "logo")).toMatchObject({ exists: false, sha256: null });
  });

  it("records a hash for every asset it checked", async () => {
    const { report } = await route(await fixture("missing-title"));
    expect(report.assets.map((a) => a.role)).toEqual(["template", "template-stylesheet", "design-stylesheet", "logo", "font", "font", "font"]);
    expect(report.assets.every((a) => a.exists && /^[a-f0-9]{64}$/.test(a.sha256!))).toBe(true);
  });
});

describe("outputs", () => {
  it("removes a stale insight.png when the new result fails", async () => {
    const outDir = await tempDir();
    await writeFile(path.join(outDir, OUTPUT_FILES.png), "stale");
    await renderInsight(inline(await fixture("missing-title")), { design, renderer: neverRender, outDir });
    expect(await exists(path.join(outDir, OUTPUT_FILES.png))).toBe(false);
    const report = JSON.parse(await readFile(path.join(outDir, OUTPUT_FILES.report), "utf8"));
    expect(report.status).toBe("fail");
  });

  it("leaves no stale pass behind when rendering crashes", async () => {
    const outDir = await tempDir();
    await writeFile(path.join(outDir, OUTPUT_FILES.png), "stale");
    await writeFile(path.join(outDir, OUTPUT_FILES.report), '{ "status": "pass" }');
    const crashing = { render: async () => Promise.reject(new Error("browser crashed")), close: async () => {} };
    await expect(renderInsight(inline(await fixture("normal")), { design, renderer: crashing, outDir })).rejects.toThrow("browser crashed");
    expect(await exists(path.join(outDir, OUTPUT_FILES.png))).toBe(false);
    expect(await exists(path.join(outDir, OUTPUT_FILES.report))).toBe(false);
  });

  it("writes a report that is stable across runs: no timestamps, no absolute paths", async () => {
    const a = await route(await fixture("missing-title"));
    const b = await route(await fixture("missing-title"));
    expect(await readFile(a.files.report, "utf8")).toBe(await readFile(b.files.report, "utf8"));
    expect(JSON.stringify(a.report)).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
  });
});
