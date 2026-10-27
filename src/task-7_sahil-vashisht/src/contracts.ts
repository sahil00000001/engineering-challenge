import { z } from "zod";

/** Template slots, in the order used by reports and by the approval digest. */
export const SLOT_NAMES = ["brand", "title", "body", "source_note"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** Slots rendered as visible approved text. The brand slot renders the configured logo instead. */
export const TEXT_SLOTS = ["title", "body", "source_note"] as const satisfies readonly SlotName[];
export type TextSlot = (typeof TEXT_SLOTS)[number];

// ─── Approved content (input) ────────────────────────────────────────────────

// C0 controls other than \n, plus DEL. The HTML parser rewrites CR and NUL, so text holding
// them could never be displayed exactly as approved. Rejecting them here keeps
// "approved text preserved" a byte-for-byte check rather than a fuzzy one.
const FORBIDDEN_CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/u;

// Characters that make the painted text differ from the stored text. Bidi overrides and
// isolates reorder it ("Trojan Source"), and long runs of combining marks stack glyphs far
// outside their line box, where layout measurement cannot see them.
const BIDI_CONTROL = /[\u{061C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;
const STACKED_MARKS = /\p{M}{4,}/u;

export const ApprovedTextSchema = z
  .string()
  .refine((value) => value.isWellFormed(), "must be well-formed Unicode (no lone surrogates)")
  .refine((value) => !FORBIDDEN_CONTROL.test(value), "must not contain control characters other than \\n")
  .refine((value) => !BIDI_CONTROL.test(value), "must not contain bidirectional control characters, which reorder the displayed text")
  .refine((value) => !STACKED_MARKS.test(value), "must not stack more than three combining marks on one character")
  .meta({
    description:
      "Approved text, rendered exactly. Line breaks (\\n) are kept. Other control characters, bidirectional controls, lone surrogates and runs of 4+ combining marks are rejected because the displayed text could not match the approved text.",
  });

// Slots may be absent, null or blank at the contract level so that a missing field is
// reported as MISSING_REQUIRED_FIELD (required_fields check), not as a generic type error.
const SlotValueSchema = ApprovedTextSchema.nullable().optional();

export const ApprovalSchema = z.strictObject({
  status: z.literal("approved"),
  approved_by: z.string().min(1),
  approved_at: z.iso.datetime({ offset: true }),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase hex SHA-256 digest"),
});

export const ApprovedContentSchema = z.strictObject({
  schema_version: z.literal("1.0"),
  content_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and hyphens"),
  synthetic: z.boolean(),
  content: z.strictObject({
    brand: SlotValueSchema,
    title: SlotValueSchema,
    body: SlotValueSchema,
    source_note: SlotValueSchema,
  }),
  approval: ApprovalSchema,
});
export type ApprovedContent = z.infer<typeof ApprovedContentSchema>;
export type ContentSlots = ApprovedContent["content"];

/** Content after the required-fields check: every slot is a non-blank string. */
export type CompleteContentSlots = Record<SlotName, string>;

// ─── Design configuration ────────────────────────────────────────────────────

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** A relative POSIX path inside the repository. No segment may start with ".", so ".." cannot escape it. */
export const RepoPathSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_][A-Za-z0-9_.,-]*(\/[A-Za-z0-9_][A-Za-z0-9_.,-]*)*$/,
    "must be a relative path inside the repository (no '..', no leading '/', no scheme)",
  );

const ProvenanceSchema = z.enum(["atomity.css", "storybook", "neutral"]);

/** A design value the stylesheet does not define, with where it came from. */
function layoutValue(value: z.ZodNumber) {
  return z.strictObject({ value, provenance: ProvenanceSchema, note: z.string().optional() });
}
const pixels = (max: number) => layoutValue(z.number().int().min(1).max(max));
const lineLimit = () => layoutValue(z.number().int().min(1).max(20));

export const FontSpecSchema = z.strictObject({
  family: z.string().min(1).regex(/^[A-Za-z0-9 ]+$/, "letters, digits and spaces only"),
  weight: z.number().int().min(100).max(900),
  style: z.enum(["normal", "italic"]),
  file: RepoPathSchema,
  used_for: z.string().min(1),
});
export type FontSpec = z.infer<typeof FontSpecSchema>;

export const DesignConfigSchema = z.strictObject({
  schema_version: z.literal("1.0"),
  template: z.strictObject({
    id: z.string().regex(SLUG),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "semantic version"),
    html: RepoPathSchema,
    stylesheet: RepoPathSchema,
  }),
  canvas: z.strictObject({
    name: z.string().regex(SLUG),
    width: z.number().int().min(100).max(4096),
    height: z.number().int().min(100).max(4096),
    device_scale_factor: z.union([z.literal(1), z.literal(2)]),
  }),
  design_foundation: z.strictObject({
    stylesheet: RepoPathSchema,
    fonts: z.array(FontSpecSchema).min(1),
  }),
  brands: z
    .record(z.string().regex(SLUG), z.strictObject({ name: z.string().min(1).max(80), logo: RepoPathSchema }))
    .refine((brands) => Object.keys(brands).length > 0, "at least one brand is required"),
  labels: z.strictObject({ source: z.string().min(1).max(40) }),
  layout: z.strictObject({
    brand_panel_width_px: pixels(2000),
    logo_height_px: pixels(400),
    logo_clear_space_px: pixels(400),
    title_font_size_px: pixels(400),
    title_line_height_px: pixels(400),
    title_max_lines: lineLimit(),
    body_font_size_px: pixels(400),
    body_line_height_px: pixels(400),
    source_note_font_size_px: pixels(400),
    source_note_line_height_px: pixels(400),
    source_note_max_lines: lineLimit(),
    label_font_size_px: pixels(400),
  }),
  validation: z.strictObject({
    overflow_tolerance_px: z.number().min(0).max(4),
    min_ink_ratio: z.number().min(0).max(1),
  }),
});
export type DesignConfig = z.infer<typeof DesignConfigSchema>;

// ─── Visual validation report (output) ───────────────────────────────────────

export const CHECK_NAMES = [
  "input_contract",
  "required_fields",
  "assets",
  "canvas",
  "content_present",
  "overflow",
  "approved_text_preserved",
  "safe_binding",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const CheckStatusSchema = z.enum(["pass", "fail", "skipped"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/** Stable failure codes, each owned by exactly one check. */
export const FAILURE_CHECK = {
  INPUT_INVALID: "input_contract",
  MISSING_REQUIRED_FIELD: "required_fields",
  UNKNOWN_BRAND: "required_fields",
  ASSET_MISSING: "assets",
  ASSET_NOT_LOADED: "assets",
  UNEXPECTED_ASSET_REQUEST: "assets",
  CANVAS_SIZE_MISMATCH: "canvas",
  CANVAS_POSITION_MISMATCH: "canvas",
  SLOT_NOT_RENDERED: "content_present",
  CONTENT_NOT_PAINTED: "content_present",
  TITLE_OVERFLOW: "overflow",
  BODY_OVERFLOW: "overflow",
  SOURCE_NOTE_OVERFLOW: "overflow",
  BRAND_OVERFLOW: "overflow",
  TEXT_CLIPPED: "overflow",
  APPROVAL_DIGEST_MISMATCH: "approved_text_preserved",
  APPROVED_TEXT_CHANGED: "approved_text_preserved",
  TEXT_ALTERED_BY_STYLE: "approved_text_preserved",
  UNSAFE_MARKUP: "safe_binding",
  SCRIPT_ACTIVITY: "safe_binding",
} as const satisfies Record<string, CheckName>;
export type FailureCode = keyof typeof FAILURE_CHECK;
const FAILURE_CODES = Object.keys(FAILURE_CHECK) as [FailureCode, ...FailureCode[]];

export const FailureSchema = z.strictObject({
  code: z.enum(FAILURE_CODES),
  check: z.enum(CHECK_NAMES),
  slot: z.enum(SLOT_NAMES).optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type Failure = z.infer<typeof FailureSchema>;

const SizeSchema = z.strictObject({ width: z.number(), height: z.number() });

const BoxSchema = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type Box = z.infer<typeof BoxSchema>;

export const SlotLayoutSchema = z.strictObject({
  lines: z.number().int().nullable(),
  max_lines: z.number().int().nullable(),
  content_box: BoxSchema,
  region_box: BoxSchema,
  overflow_bottom_px: z.number(),
  overflow_right_px: z.number(),
  ink_ratio: z.number().nullable(),
});
export type SlotLayout = z.infer<typeof SlotLayoutSchema>;

export const AssetRecordSchema = z.strictObject({
  role: z.enum(["template", "template-stylesheet", "design-stylesheet", "logo", "font"]),
  path: z.string(),
  exists: z.boolean(),
  sha256: z.string().nullable(),
  /** null when the browser was not reached (rendering skipped). */
  loaded: z.boolean().nullable(),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

export const ValidationReportSchema = z.strictObject({
  report_version: z.literal("1.0"),
  /** Visual validation only. Content quality (G2 evidence and validity) belongs to Task 6 and is never scored here. */
  scope: z.literal("visual-validation"),
  template: z.strictObject({ id: z.string(), version: z.string() }),
  content_id: z.string().nullable(),
  status: z.enum(["pass", "fail"]),
  canvas: z.strictObject({ expected: SizeSchema, actual: SizeSchema.nullable() }),
  checks: z.strictObject({
    input_contract: CheckStatusSchema,
    required_fields: CheckStatusSchema,
    assets: CheckStatusSchema,
    canvas: CheckStatusSchema,
    content_present: CheckStatusSchema,
    overflow: CheckStatusSchema,
    approved_text_preserved: CheckStatusSchema,
    safe_binding: CheckStatusSchema,
  }),
  failures: z.array(FailureSchema),
  layout: z.partialRecord(z.enum(SLOT_NAMES), SlotLayoutSchema),
  security: z
    .strictObject({
      page_javascript_enabled: z.literal(false),
      blocked_requests: z.array(z.string()),
      csp_violations: z.array(z.string()),
      dialogs: z.number().int(),
      page_errors: z.array(z.string()),
    })
    .nullable(),
  assets: z.array(AssetRecordSchema),
  inputs: z.strictObject({
    content_file: z.string().nullable(),
    content_file_sha256: z.string().nullable(),
    approval_digest_recorded: z.string().nullable(),
    approval_digest_computed: z.string().nullable(),
    design_config_file: z.string().nullable(),
    design_config_sha256: z.string().nullable(),
  }),
  outputs: z.strictObject({
    png: z.string().nullable(),
    png_sha256: z.string().nullable(),
    html: z.string().nullable(),
  }),
  renderer: z
    .strictObject({
      engine: z.string(),
      browser_version: z.string(),
      viewport: SizeSchema,
      device_scale_factor: z.number(),
    })
    .nullable(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

/** Flattens Zod issues into stable "path: message" strings for reports and errors. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
}
