import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approvalDigest } from "../src/approval.js";
import {
  ApprovedContentSchema,
  ApprovedTextSchema,
  DesignConfigSchema,
  FAILURE_CHECK,
  ValidationReportSchema,
  type CompleteContentSlots,
} from "../src/contracts.js";
import { DesignConfigError, loadDesignConfig } from "../src/pipeline.js";
import { resolveRepoPath } from "../src/paths.js";
import { FIXTURES, fixture, tempDir } from "./helpers.js";

describe("approved-content contract", () => {
  it("accepts every supplied fixture except the malformed one", async () => {
    for (const file of await readdir(FIXTURES)) {
      const result = ApprovedContentSchema.safeParse(await fixture(path.basename(file, ".json")));
      expect(result.success, file).toBe(file !== "malformed.json");
    }
  });

  it.each([
    ["carriage return", "line\r\nbreak"],
    ["NUL", "nul\u0000byte"],
    ["tab", "tab\there"],
    ["lone surrogate", "broken \ud800 pair"],
  ])("rejects approved text containing a %s, which HTML parsing would rewrite", (_label, text) => {
    expect(ApprovedTextSchema.safeParse(text).success).toBe(false);
  });

  it.each([
    ["a right-to-left override", 0x202e],
    ["a left-to-right isolate", 0x2066],
    ["a right-to-left mark", 0x200f],
  ])("rejects approved text containing %s, which reorders what is displayed", (_label, codePoint) => {
    const text = `Revenue fell ${String.fromCodePoint(codePoint)}%24`;
    const result = ApprovedTextSchema.safeParse(text);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/bidirectional control/);
  });

  it("rejects stacked combining marks but accepts ordinary diacritics", () => {
    const combining = (codePoints: number[]) => codePoints.map((c) => String.fromCodePoint(c)).join("");
    expect(ApprovedTextSchema.safeParse(`e${combining([0x0323, 0x0302])} decomposed`).success).toBe(true);
    expect(ApprovedTextSchema.safeParse(`z${combining([0x0300, 0x0301, 0x0302, 0x0303, 0x0304])}`).success).toBe(false);
  });

  it("accepts line breaks, no-break spaces and astral characters", () => {
    expect(ApprovedTextSchema.safeParse("one\n\ntwo\u00a0three 🌍").success).toBe(true);
  });

  it("requires an approval record with status approved", async () => {
    const normal = await fixture("normal");
    expect(ApprovedContentSchema.safeParse({ ...normal, approval: { ...normal.approval, status: "pending" } }).success).toBe(false);
    const { approval: _omitted, ...unapproved } = normal;
    expect(ApprovedContentSchema.safeParse(unapproved).success).toBe(false);
  });
});

describe("approval digest", () => {
  const slots: CompleteContentSlots = { brand: "atomity", title: "T", body: "B", source_note: "S" };

  it("does not depend on the key order of the input object", () => {
    const reordered = { source_note: "S", body: "B", title: "T", brand: "atomity" } as CompleteContentSlots;
    expect(approvalDigest(reordered)).toBe(approvalDigest(slots));
  });

  it("changes when any single character changes, including invisible ones", () => {
    const base = approvalDigest(slots);
    expect(approvalDigest({ ...slots, body: "B " })).not.toBe(base);
    expect(approvalDigest({ ...slots, title: "T\u00a0" })).not.toBe(base);
    expect(approvalDigest({ ...slots, source_note: "s" })).not.toBe(base);
  });

  it("matches the recorded digest of every complete fixture except the one changed after approval", async () => {
    for (const name of ["normal", "long-title", "long-body", "html-script-input", "special-characters", "changed-after-approval"]) {
      const f = await fixture(name);
      const matches = approvalDigest(f.content) === f.approval.content_sha256;
      expect(matches, name).toBe(name !== "changed-after-approval");
    }
  });
});

describe("design configuration contract", () => {
  it("accepts the shipped configuration", async () => {
    const { config } = await loadDesignConfig();
    expect(config.canvas).toMatchObject({ width: 1200, height: 627 });
  });

  it.each([
    ["a parent-directory segment", "../secrets/logo.svg"],
    ["an absolute path", "/etc/passwd"],
    ["a URL", "https://cdn.example/logo.svg"],
    ["a Windows drive", "C:/logo.svg"],
    ["a dot segment", "design/./atomity_logo.svg"],
  ])("rejects an asset path with %s", async (_label, logo) => {
    const { config } = await loadDesignConfig();
    const bad = structuredClone(config) as Record<string, any>;
    bad.brands.atomity.logo = logo;
    expect(DesignConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses to resolve a path outside the repository even if the schema were bypassed", () => {
    expect(() => resolveRepoPath("../outside.txt")).toThrow(/escapes the repository/);
  });

  it("rejects unknown keys and non-integer canvas sizes with a readable error", async () => {
    const dir = await tempDir();
    const { config } = await loadDesignConfig();
    const file = path.join(dir, "bad.json");
    await writeFile(file, JSON.stringify({ ...config, canvas: { ...config.canvas, width: 1200.5 }, theme: "dark" }));
    await expect(loadDesignConfig(file)).rejects.toThrow(DesignConfigError);
    await expect(loadDesignConfig(file)).rejects.toThrow(/canvas\.width[\s\S]*Unrecognized key: "theme"/);
  });
});

describe("visual-validation report contract", () => {
  it("has no field for content-quality, G2 or engagement scores", () => {
    const fields = Object.keys(ValidationReportSchema.shape);
    expect(fields.filter((f) => /score|g2|quality|engagement|evidence/i.test(f))).toEqual([]);
    expect(ValidationReportSchema.shape.scope.value).toBe("visual-validation");
  });

  it("assigns every failure code to exactly one check", () => {
    for (const [code, check] of Object.entries(FAILURE_CHECK)) {
      expect(ValidationReportSchema.shape.checks.shape, code).toHaveProperty(check);
    }
  });
});
