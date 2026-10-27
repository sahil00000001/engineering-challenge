/**
 * Browser-free tests of the visual validator. Each case starts from synthetic evidence
 * that passes, breaks exactly one thing, and asserts the precise failure that results.
 */
import { describe, expect, it } from "vitest";
import type { FailureCode } from "../src/contracts.js";
import { validateRender, type RenderEvidence } from "../src/validate.js";
import { APPROVED, syntheticEvidence, syntheticPng } from "./helpers.js";

async function failuresAfter(mutate: (e: RenderEvidence) => void) {
  const evidence = await syntheticEvidence();
  mutate(evidence);
  return validateRender(evidence).failures;
}

function codes(failures: Array<{ code: FailureCode }>): FailureCode[] {
  return failures.map((f) => f.code);
}

describe("validateRender", () => {
  it("passes untouched synthetic evidence", async () => {
    const result = validateRender(await syntheticEvidence());
    expect(result.failures).toEqual([]);
    expect(result.layout.title).toMatchObject({ lines: 2, max_lines: 3, overflow_bottom_px: 0 });
  });

  describe("overflow", () => {
    it("reports a title with more lines than its region allows", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.title.rect = { x: 48, y: 48, width: 804, height: 260 };
      });
      expect(failures).toEqual([
        expect.objectContaining({ code: "TITLE_OVERFLOW", check: "overflow", slot: "title", details: expect.objectContaining({ lines: 5, max_lines: 3, overflow_bottom_px: 156 }) }),
      ]);
    });

    it("reports a body taller than its region", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.body.rect = { x: 48, y: 176, width: 804, height: 400 };
      });
      expect(codes(failures)).toEqual(["BODY_OVERFLOW"]);
      expect(failures[0]!.message).toMatch(/88px taller than its region/);
    });

    it("reports text taller than a slot whose own height is fixed by the template", async () => {
      const failures = await failuresAfter((e) => {
        const title = e.measurement.slots.title;
        title.rect = { x: 48, y: 48, width: 804, height: 52 };
        title.region_rect = { x: 48, y: 48, width: 804, height: 52 };
        title.client_height = 52;
        title.scroll_height = 104;
      });
      expect(failures).toEqual([expect.objectContaining({ code: "TITLE_OVERFLOW", details: expect.objectContaining({ overflow_bottom_px: 52 }) })]);
    });

    it("does not mistake a few pixels of descender overhang for overflow", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.title.scroll_height = 106;
      });
      expect(failures).toEqual([]);
    });

    it("reports horizontal overflow from an unbreakable string", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.source_note.scroll_width = 950;
      });
      expect(codes(failures)).toEqual(["SOURCE_NOTE_OVERFLOW"]);
    });

    it("tolerates sub-pixel rounding within the configured tolerance", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.title.rect = { x: 48, y: 48, width: 804, height: 104.6 };
      });
      expect(failures).toEqual([]);
    });

    it("reports a logo that intrudes on its clear space", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.brand.rect = { x: 932, y: 580, width: 222, height: 32 };
      });
      expect(codes(failures)).toEqual(["BRAND_OVERFLOW"]);
    });

    it.each([
      ["text-overflow: ellipsis", { text_overflow: "ellipsis" }],
      ["line clamping", { line_clamp: "2" }],
    ])("treats %s as clipping approved text", async (_label, styles) => {
      const failures = await failuresAfter((e) => {
        Object.assign(e.measurement.slots.body.styles!, styles);
      });
      expect(codes(failures)).toEqual(["TEXT_CLIPPED"]);
    });

    it("reports an ancestor that cuts the slot off", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.body.clipped_by = ["div.insight__region.insight__region--body"];
      });
      expect(codes(failures)).toEqual(["TEXT_CLIPPED"]);
    });
  });

  describe("approved text preserved", () => {
    it("reports rendered text that differs from the approved text, and where", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.body.text = e.approved.body.replace("42", "47");
      });
      expect(failures).toEqual([
        expect.objectContaining({
          code: "APPROVED_TEXT_CHANGED",
          slot: "body",
          details: expect.objectContaining({ first_difference_at: APPROVED.body.indexOf("42") + 1, expected_excerpt: expect.stringContaining("42"), actual_excerpt: expect.stringContaining("47") }),
        }),
      ]);
    });

    it("treats whitespace changes as changes", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.title.text = `${e.approved.title} `;
      });
      expect(codes(failures)).toEqual(["APPROVED_TEXT_CHANGED"]);
    });

    it("reports a brand name that is not the configured one", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.brand.text = "Atomity Inc.";
      });
      expect(failures).toEqual([expect.objectContaining({ code: "APPROVED_TEXT_CHANGED", slot: "brand" })]);
    });

    it.each([
      // As in a real browser, ::first-line and ::first-letter inherit the element's transform.
      ["text-transform", { text_transform: "uppercase", first_line_text_transform: "uppercase", first_letter_text_transform: "uppercase" }],
      ["::first-line text-transform", { first_line_text_transform: "uppercase" }],
      ["::first-letter text-transform", { first_letter_text_transform: "lowercase" }],
      ["small caps", { font_variant_caps: "all-small-caps" }],
      ["right-to-left direction", { direction: "rtl" }],
      ["a bidi override", { unicode_bidi: "bidi-override" }],
      ["text security discs", { text_security: "disc" }],
      ["::before content", { before_content: '"Breaking: "' }],
      ["::after content", { after_content: '"*"' }],
    ])("reports %s that changes what the reader sees", async (_label, styles) => {
      const failures = await failuresAfter((e) => {
        Object.assign(e.measurement.slots.title.styles!, styles);
      });
      expect(codes(failures)).toEqual(["TEXT_ALTERED_BY_STYLE"]);
    });
  });

  describe("content present", () => {
    it("reports a missing slot element", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.source_note = { ...e.measurement.slots.source_note, count: 0, rect: null };
      });
      expect(codes(failures)).toEqual(["SLOT_NOT_RENDERED"]);
    });

    it("reports a hidden slot", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.body.visible = false;
      });
      expect(codes(failures)).toContain("SLOT_NOT_RENDERED");
    });

    it("reports text that is in the DOM but not painted", async () => {
      const failures = await failuresAfter((e) => {
        e.png = syntheticPng(1200, 627, false);
      });
      expect(codes(failures)).toEqual(["CONTENT_NOT_PAINTED", "CONTENT_NOT_PAINTED", "CONTENT_NOT_PAINTED", "CONTENT_NOT_PAINTED"]);
    });
  });

  describe("canvas", () => {
    it("reports a PNG with the wrong dimensions", async () => {
      const failures = await failuresAfter((e) => {
        e.png = syntheticPng(1080, 1350);
      });
      expect(failures).toContainEqual(expect.objectContaining({ code: "CANVAS_SIZE_MISMATCH", details: expect.objectContaining({ source: "png", actual: { width: 1080, height: 1350 } }) }));
    });

    it("reports a canvas that is offset from the captured area, and checks slots against the capture", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.canvas.rect = { x: 80, y: 0, width: 1200, height: 627 };
        e.measurement.slots.brand.rect = { x: 1012, y: 563, width: 222, height: 32 };
        e.measurement.slots.brand.region_rect = { x: 980, y: 0, width: 300, height: 627 };
      });
      expect(codes(failures)).toEqual(["CANVAS_POSITION_MISMATCH", "BRAND_OVERFLOW"]);
      expect(failures[1]!.message).toMatch(/extends past the canvas edge/);
    });

    it("reports a template without exactly one canvas element", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.canvas.count = 2;
      });
      expect(codes(failures)).toEqual(["CANVAS_SIZE_MISMATCH"]);
    });
  });

  describe("assets", () => {
    it("reports a font that did not load", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.fonts[3]!.loaded = false;
      });
      expect(failures).toEqual([expect.objectContaining({ code: "ASSET_NOT_LOADED", details: expect.objectContaining({ family: "Gowun Batang" }) })]);
    });

    it("reports a logo that did not load", async () => {
      const failures = await failuresAfter((e) => {
        e.measurement.slots.brand.image = { complete: true, natural_width: 0, natural_height: 0, src: "" };
      });
      expect(codes(failures)).toContain("ASSET_NOT_LOADED");
    });

    it("reports a stylesheet that was never requested", async () => {
      const failures = await failuresAfter((e) => {
        e.servedAssets = new Set(["/design/atomity_logo.svg"]);
      });
      expect(codes(failures)).toEqual(["ASSET_NOT_LOADED", "ASSET_NOT_LOADED"]);
    });

    it("reports requests outside the allowlist and blocked resource loads", async () => {
      const failures = await failuresAfter((e) => {
        e.security.blocked_requests = ["https://tracker.invalid/pixel.png"];
        e.security.csp_violations = ["Loading the image 'https://evil.invalid/x.png' violates the following Content Security Policy directive"];
      });
      expect(codes(failures)).toEqual(["UNEXPECTED_ASSET_REQUEST", "UNEXPECTED_ASSET_REQUEST"]);
    });
  });

  describe("safe binding", () => {
    it.each([
      ["an element inside a slot", (e: RenderEvidence) => void (e.measurement.slots.body.child_elements = 1)],
      ["a script element", (e: RenderEvidence) => void (e.measurement.document.script_elements = 1)],
      ["an inline event handler", (e: RenderEvidence) => void (e.measurement.document.event_handler_attributes = 1)],
      ["a structure that differs from the template", (e: RenderEvidence) => void (e.measurement.document.skeleton = { matches: false, expected_length: 20, actual_length: 21, first_difference: { index: 9, expected: "div[class,data-region]", actual: "img[onerror,src]" } })],
      ["a blocked inline style", (e: RenderEvidence) => void (e.security.csp_violations = ["Applying inline style violates the following Content Security Policy directive"])],
    ])("reports %s as UNSAFE_MARKUP", async (_label, mutate) => {
      expect(codes(await failuresAfter(mutate))).toEqual(["UNSAFE_MARKUP"]);
    });

    it("reports any observed script activity", async () => {
      const failures = await failuresAfter((e) => {
        e.security.dialogs = 1;
      });
      expect(codes(failures)).toEqual(["SCRIPT_ACTIVITY"]);
    });
  });
});

