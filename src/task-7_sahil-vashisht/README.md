# Task 7: One Visual Template (`single-insight-v1`)

Approved content and a design configuration go in. A 1200 × 627 PNG and a separate
visual-validation report come out. The PNG is rendered by headless Chromium from one
reusable HTML/CSS template built on the supplied Atomity design foundation.

```text
Approved content (JSON) ─┐
                         ├─▶ contract + approval digest ─▶ escaped binding ─▶ Chromium ─▶ PNG
Design configuration ────┘        (refuse, don't render)      (text only)      (JS off,      │
                                                                                CSP, allow-  ▼
                                                                                list)  visual-validation report
```

- Live showcase of every example render and report: **[task-7-insight-template.vercel.app](https://task-7-insight-template.vercel.app)**. This is a static
  view of the committed `examples/` folder. The challenge does not ask for it, and the
  renderer does not need it.
- Rendered example: [`examples/normal/insight.png`](examples/normal/insight.png) and
  [`report.json`](examples/normal/report.json).
- All examples, including failures: [`examples/README.md`](examples/README.md).
- Seven captioned explainer films, one overview plus one per required check:
  [`videos/`](videos/README.md). They are also playable on the live showcase. They are
  extra material for reviewers, rendered from code (`videos/source/`), and the challenge
  does not require them.

## Quick start

Requires Node.js 22.12 or later. Run everything from this folder.

```bash
cd src/task-7_sahil-vashisht
npm ci
npx playwright install chromium            # one-time browser download (~120 MB)
                                           # Linux CI images may need: npx playwright install --with-deps chromium
npm test                                   # unit tests + end-to-end tests through real Chromium (~25 s)
npm run typecheck                          # strict TypeScript, including the in-page JS
```

Render one content file:

```bash
npm run render -- fixtures/normal.json                 # writes out/normal/
npm run render -- fixtures/long-body.json --out /tmp/x # any output folder
npm run render -- my-content.json --config config/single-insight-v1.design.json
```

| | |
| --- | --- |
| Rendering command | `npm run render -- <content.json> [--out <dir>] [--config <design.json>]` (`tsx src/cli.ts`) |
| Dependencies | Node ≥ 22.12, `playwright` 1.64 (Chromium 156 headless shell), `zod`, `pngjs`; dev: `typescript`, `tsx`, `vitest` |
| Canvas | **1200 × 627 px**, device scale factor 1: the "single insight image" size from the brief |
| Output | `<out>/report.json` always, `<out>/insight.html` when rendered, and `<out>/insight.png` (pass) **or** `<out>/insight.failed.png` (rendered but failed validation). Default `<out>` is `out/<content-file-name>/` |
| Exit codes | `0` pass · `1` visual validation failed (see report) · `2` usage, configuration or environment error |
| Regenerate all examples | `npm run examples` (renders every fixture into `examples/`) |

Rendering is fully offline. The only download is the one-time browser install. No
credentials, paid services or external network are involved.

## What is in this folder

```text
config/single-insight-v1.design.json   design configuration: canvas, type scale, limits, assets (each value says where it came from)
template/single-insight-v1.html        the reusable template: four slots, semantic HTML, links ../../../design/atomity.css in place
template/single-insight-v1.css         layout only; every colour, font and spacing value is an atomity.css token
src/contracts.ts                       Zod contracts: approved content, design configuration, validation report
src/binder.ts                          context-checked, single-pass, HTML-escaping template binder
src/renderer.ts                        Renderer interface + Chromium implementation (virtual origin, allowlist, CSP, JS off)
src/browser/measure.js                 read-only layout measurement evaluated inside the page
src/validate.ts                        pure validator: measurements + PNG -> failures
src/pipeline.ts                        contract -> required fields -> assets -> approval digest -> bind -> render -> validate -> write
src/cli.ts                             command-line entry point
fixtures/                              synthetic approved-content fixtures (all marked "synthetic": true)
examples/                              generated renders and reports for every fixture (do not edit by hand)
schemas/                               JSON Schema export of the three contracts (npm run schemas)
tests/                                 Vitest: unit tests + end-to-end tests through real Chromium
scripts/                               examples generator, fixture approval stamp, schema export, showcase build
site/, vercel.json                     static showcase only (not part of the renderer)
```

## How it works

**1. Input contract.** Approved content is a small JSON envelope
([schema](schemas/approved-content.schema.json)): `content_id`, the four slot values
(`brand`, `title`, `body`, `source_note`) and an `approval` record holding
`content_sha256`, the digest recorded when the content was approved upstream. Unknown
keys, wrong types and a missing or non-`approved` approval are `INPUT_INVALID`. Approved
text may not contain characters that would make the displayed text differ from the stored
text:

- CR, NUL and other control characters, and lone surrogates, which the HTML parser
  rewrites
- bidirectional controls (U+202A–U+202E, U+2066–U+2069, LRM, RLM, ALM), which reorder what
  is painted. With them, `"fell \u202E%24"` paints as "fell 42%".
- runs of four or more combining marks, which stack glyphs far outside their line box

**2. Required fields.** Each slot must be present and non-blank. Absent, `null`, `""`
and whitespace-only values all give `MISSING_REQUIRED_FIELD` naming the field. The brand
slot holds a brand id. It must name a brand the design configuration supplies (only
`atomity`), otherwise `UNKNOWN_BRAND`. No brand asset is ever invented.

**3. Asset preflight.** The template, both stylesheets, the logo and the font files must
exist. Each is recorded in the report with its SHA-256.

**4. Approval digest.** The digest of the slot values (canonical JSON in a fixed key
order, no normalisation) must equal the recorded `content_sha256`. Content changed after
approval fails `APPROVAL_DIGEST_MISMATCH` **before** rendering.

Anything that fails steps 1–4 is **never rendered**. The report says why, and the
render-dependent checks are `skipped`.

**5. Bind.** [`binder.ts`](src/binder.ts) fills `{{title}}`, `{{body}}` and
`{{source_note}}` by HTML-escaping the value (`& < > " '`) in a single pass, so a value
containing `{{title}}`, `$&` or `</p>` stays literal. On every bind it checks the template
itself with a small HTML tokenizer that tracks comments, quoted attribute values (so a `>`
inside a value cannot end a tag early) and `<script>`/`<style>` raw text. Content
placeholders may only be element text, never inside a tag, a `<script>` or a `<style>`. A
misplaced placeholder throws rather than silently opening an injection path. Renderer-derived values (`{{@csp}}`, `{{@brand_name}}`, and so on) may fill a whole
quoted attribute. The single `{{@config_css}}` block accepts only a strict CSS character
set.

**6. Render.** [`renderer.ts`](src/renderer.ts) serves the bound document from a virtual
origin, `https://insight-renderer.invalid` (the `.invalid` TLD can never resolve). The
document is served at the template's own path, so relative links work exactly as on disk.
Every request is intercepted. Only the allowlisted asset files are served from `design/`
and the template folder, and anything else is blocked and recorded. The browser context
has **JavaScript disabled**. The document carries a **CSP**, sent as both a header and a
`<meta>`, that allows no scripts and no inline styles except the one configuration block,
pinned by its SHA-256. Fonts and the logo are awaited before measuring. Determinism
controls: fixed viewport = canvas, scale factor 1, `en-US`/UTC/light/reduced motion,
`--font-render-hinting=none --disable-lcd-text --force-color-profile=srgb`, self-hosted
fonts only, a Chromium build pinned by `package-lock.json`.

**7. Validate.** [`measure.js`](src/browser/measure.js) reads the live DOM: each slot's box,
its bounded region, line height, computed text-altering styles, clipping ancestors,
`textContent`, font load status, logo decode status, and the page's element-and-attribute
skeleton. [`validate.ts`](src/validate.ts) is a pure function. It compares those
measurements, plus the PNG pixels, against the approved text, the layout limits and the
template's own skeleton.

**8. Write.** `report.json` is always written. A passing render writes `insight.png`. A
render that fails validation keeps its pixels as `insight.failed.png`, so a failed visual
can never be picked up as a deliverable. Stale outputs from earlier runs are deleted first.
`insight.html` is the rendered document plus one `<base href>`, so it opens styled from the
output folder.

## The visual-validation report

[Schema](schemas/validation-report.schema.json). Real examples:
[pass](examples/normal/report.json), [overflow](examples/long-body/report.json),
[missing field](examples/missing-source-note/report.json).

```jsonc
{
  "report_version": "1.0",
  "scope": "visual-validation",           // never content quality: no score, G2 or engagement fields exist
  "template": { "id": "single-insight-v1", "version": "1.0.0" },
  "content_id": "insight-normal",
  "status": "pass",
  "canvas": { "expected": { "width": 1200, "height": 627 }, "actual": { "width": 1200, "height": 627 } },
  "checks": {
    "input_contract": "pass", "required_fields": "pass", "assets": "pass", "canvas": "pass",
    "content_present": "pass", "overflow": "pass", "approved_text_preserved": "pass", "safe_binding": "pass"
  },
  "failures": [],                          // e.g. { "code": "BODY_OVERFLOW", "check": "overflow", "slot": "body", "message": "...", "details": {...} }
  "layout": { "title": { "lines": 2, "max_lines": 3, "overflow_bottom_px": 0, "ink_ratio": 0.2807, ... }, ... },
  "security": { "page_javascript_enabled": false, "blocked_requests": [], "csp_violations": [], "dialogs": 0, "page_errors": [] },
  "assets": [ { "role": "logo", "path": "design/atomity_logo.svg", "exists": true, "sha256": "...", "loaded": true }, ... ],
  "inputs": { "content_file": "...", "approval_digest_recorded": "...", "approval_digest_computed": "...", ... },
  "outputs": { "png": "insight.png", "png_sha256": "...", "html": "insight.html" },
  "renderer": { "engine": "chromium", "browser_version": "156.0.8078.4", ... }
}
```

Each check is `pass`, `fail` or `skipped` (not reached because an earlier gate stopped
the render). Failure codes are stable, and each belongs to exactly one check:

| Check | Failure codes | What is verified |
| --- | --- | --- |
| `input_contract` | `INPUT_INVALID` | JSON parses and matches the approved-content contract (all issues listed) |
| `required_fields` | `MISSING_REQUIRED_FIELD`, `UNKNOWN_BRAND` | title, body, source note and brand are present and non-blank; the brand is one the design supplies |
| `assets` | `ASSET_MISSING`, `ASSET_NOT_LOADED`, `UNEXPECTED_ASSET_REQUEST` | files exist; stylesheets, every configured font face and the logo actually loaded; nothing outside the allowlist was requested |
| `canvas` | `CANVAS_SIZE_MISMATCH`, `CANVAS_POSITION_MISMATCH` | the PNG and the single `[data-canvas]` element are exactly the configured size, and the canvas starts at the top-left of the capture |
| `content_present` | `SLOT_NOT_RENDERED`, `CONTENT_NOT_PAINTED` | each slot exists once, is visible and has size, and its pixels in the PNG are actually painted (catches transparent or unloaded text) |
| `overflow` | `TITLE_OVERFLOW`, `BODY_OVERFLOW`, `SOURCE_NOTE_OVERFLOW`, `BRAND_OVERFLOW`, `TEXT_CLIPPED` | each slot's full content (including text spilling out of a fixed-height slot) fits its region and the captured area (title ≤ 3 lines, source note ≤ 2); the logo keeps its clear space; nothing is hidden by `overflow`, `clip-path` or a mask, ellipsised or line-clamped |
| `approved_text_preserved` | `APPROVAL_DIGEST_MISMATCH`, `APPROVED_TEXT_CHANGED`, `TEXT_ALTERED_BY_STYLE` | input matches its approval; rendered `textContent` (and logo alt) equals the approved text byte for byte; no style that changes how it reads: `text-transform` (also on `::first-line`/`::first-letter`), small caps, RTL direction, bidi override, `-webkit-text-security`, or generated `::before`/`::after` text |
| `safe_binding` | `UNSAFE_MARKUP`, `SCRIPT_ACTIVITY` | slots contain text only; no `<script>`, no inline handlers, no blocked inline styles; the element-and-attribute skeleton equals the template's; no dialogs or page errors |

## Required checks: where each one is proven

| Brief | Fixture | Test | Outcome |
| --- | --- | --- | --- |
| 1. Normal content | [`normal.json`](fixtures/normal.json) | `tests/render.test.ts` › 1. normal content | `pass`, 1200×627 `insight.png`, all 8 checks pass, pixel-identical on re-render |
| 2. Long title | [`long-title.json`](fixtures/long-title.json) | › 2. long title | `TITLE_OVERFLOW` (6 lines where at most 3 fit); no `insight.png` |
| 3. Long body | [`long-body.json`](fixtures/long-body.json) | › 3. long body | `BODY_OVERFLOW`; text is not clipped or hidden, so `approved_text_preserved` still passes |
| 4. Missing required field | [`missing-title.json`](fixtures/missing-title.json), [`missing-source-note.json`](fixtures/missing-source-note.json) | `tests/pipeline.test.ts` › missing required fields | all 4 slots × absent/null/empty/whitespace give `MISSING_REQUIRED_FIELD`; the renderer is never called |
| 5. HTML/script-like input | [`html-script-input.json`](fixtures/html-script-input.json) | › 5. HTML and script-like input | `pass`: shown literally, 0 requests, 0 CSP violations, 0 dialogs. A negative control with a deliberately unescaped binder is caught as `UNSAFE_MARKUP` |
| 6. Changed approved text | [`changed-after-approval.json`](fixtures/changed-after-approval.json) | `pipeline.test.ts` + `render.test.ts` › 6. changed approved text | edited after approval gives `APPROVAL_DIGEST_MISMATCH`; a renderer that rewrites 42 → 47 gives `APPROVED_TEXT_CHANGED` with the differing excerpt; `text-transform` or generated text gives `TEXT_ALTERED_BY_STYLE`; an ellipsis gives `TEXT_CLIPPED` |

Also covered: special characters survive byte for byte
([`special-characters.json`](fixtures/special-characters.json)); malformed input
([`malformed.json`](fixtures/malformed.json), non-JSON, arrays, `null`); a remote
stylesheet, an off-allowlist file and a missing logo; a logo too wide for its clear space
(reported, never squashed); templates that hide or misrepresent text (`overflow: hidden`, a fixed slot
height, `clip-path`, an offset canvas, bidi override, text-security discs, small caps,
`::first-line` uppercase); binder context rules; config path traversal; report schema
separation from G2; every validator failure code in isolation (`tests/validate.test.ts`,
no browser); CLI exit codes.

## Design foundation, tokens and configuration

The template links [`design/atomity.css`](../../design/atomity.css) in place (so its
`./fonts/` URLs resolve to the real typefaces) and the logo from
[`design/atomity_logo.svg`](../../design/atomity_logo.svg). Nothing from `design/` is
copied or modified. Content, layout and tokens stay separate:

- **Content**: the fixture's slot values, bound only as text.
- **Layout**: [`single-insight-v1.css`](template/single-insight-v1.css). A two-column grid:
  a cream content column (title, body, then a hairline and the source) and a mint brand
  panel holding the wordmark.
- **Tokens and components** from atomity.css:
  - surfaces: `--surface-page`, `.surface-mint`
  - text: `--text-primary`, `--atomity-gray-700`, `--text-secondary`
  - lines: `--border-light`
  - fonts: `--font-title` and `--font-display` (Google Sans Flex), `--font-body` (Gowun Batang)
  - spacing: fractions of `--space-section-sm`
  - layering: `--z-raised`
  - components: `.eyebrow` (Code caps with the `--atomity-green-dark` rule), `.backdrop-grid`

Type choices follow the Storybook typography page. Flex is used for headings and anything
a person reads, with headings tracked at −0.02em and weight 700. Code is used only for the
short "Source" label, never for running copy. Gowun Batang, `--font-body`, is "reserved for
long-form, editorial copy", and the post body is exactly that. The wordmark is used as
**ink on mint**, a placement Storybook documents ("Ink on mint measures 13:1"). It is set
by height with `width: auto` and is never recoloured or stretched. The grid texture never
runs behind the wordmark or the text.

Values atomity.css does not define live in the
[design configuration](config/single-insight-v1.design.json). Each carries a `provenance`
of `storybook` or `neutral`. The renderer injects them as `--insight-*` custom properties.

| Value | Setting | Provenance |
| --- | --- | --- |
| Canvas | 1200 × 627, scale 1 | brief ("single insight image") |
| Logo height | 32 px, width auto | Storybook (every Brand Assets placement) |
| Label size | 13 px Code caps | Storybook label scale |
| Logo clear space | 32 px (one logo height) | **neutral**: no rule supplied |
| Brand panel width | 300 px | **neutral** |
| Title | 46/52 px, max 3 lines | **neutral**: no social-image type scale supplied |
| Body | 22/34 px | **neutral** (close to `.text-subtitle`'s 1.6) |
| Source note | 15/22 px, max 2 lines | **neutral** |

**Developer handoff.** The renderer needs these design inputs:

- the logo `design/atomity_logo.svg`
- the fonts in `design/fonts/` (Google Sans Flex, Google Sans Code, Gowun Batang Regular)
- the colour, spacing and typography tokens from `design/atomity.css`
- the template-specific values above
- an example layout: [`examples/normal/insight.png`](examples/normal/insight.png)
- approved sample text: [`fixtures/normal.json`](fixtures/normal.json)

No other brand asset is used. The white wordmark shown in Storybook is not part of
`design/`, so it was not used.

## Accessibility

The rendered HTML ([example](examples/normal/insight.html)) stands on its own:

- `<html lang="en">`, and a `<title>` equal to the approved title
- an `<article>` labelled by its `<h1>` title
- the body as a `<p>`
- the source in a `<footer>`, with a visible "Source" text label (not colour alone)
- the brand as an `<img alt="Atomity">` in an `<aside aria-label="Published by">`
- decoration (the grid) marked `aria-hidden`

Text is real text in reading order, with the line breaks it was approved with. Every
colour pairing is a text-on-surface pairing atomity.css defines.

## Security

Approved content is treated as untrusted at the rendering boundary. The defence layers
are independent:

1. Context-checked escaping that only ever produces text nodes.
2. Page JavaScript disabled.
3. A hash-pinned CSP with no script and no other inline style.
4. A request allowlist on a non-resolvable origin.
5. Post-render verification that the DOM skeleton equals the template's, so any markup
   that got through is reported as `UNSAFE_MARKUP`.

Tests switch off layer 1 on purpose (`unescapedBinder`). The remaining layers keep the
injected markup inert, and the validator still fails the render. No credentials, tokens or
secrets exist in this submission.

## Decision note

**Chosen approach.** One static HTML template with four declared slots, bound in Node by a
small escaping binder, then rendered and measured in Chromium. Validation reads the real
browser layout (DOM boxes, computed styles, text content) and the real pixels. It does not
predict text size in Node. Overflow is a property of a bounded region, never something to
fix: the template never shrinks, clips or ellipsises approved text. A visual that doesn't
fit fails, and the content must be shortened and re-approved upstream.

**Alternative considered: a general template engine** (Handlebars or Nunjucks with
autoescape). Its escaping is sound, but it also offers raw-output helpers (`{{{ }}}`,
`| safe`), logic and partials. These are more ways for approved text to become markup, and
none of them is needed for four text slots. A ~170-line binder whose context rules are
checked on every bind, plus a post-render skeleton check, is smaller to audit and easier
to prove. Binding inside the page with `textContent` was also rejected: it needs page
script (or a DOM-mutating evaluation), and the saved HTML would then no longer be the
exact document that was rendered.

**Known limitations.**

- One template and one canvas. The configuration accepts other sizes, but the type scale
  is tuned for 1200 × 627. A 1080 × 1350 portrait would need its own configuration values.
- Pixel output is identical on re-render on the same machine and Chromium build (tested).
  Font anti-aliasing differs between operating systems, so PNG bytes differ across
  platforms. The committed examples were rendered on Windows.
- Glyph coverage is not checked. A character the brand fonts lack (emoji, CJK) falls back
  to a system font without a failure.
- The approval digest proves integrity, not authenticity. It sits in the same file as the
  content, so it catches accidental or unreviewed edits, but anyone who can edit the file
  can restamp it (`npm run approve` does exactly that for fixtures). Production use would
  need the approval service to sign the digest, for example with an HMAC or a signature,
  and the renderer to verify that signature.
- The binder's context rules use a small tokenizer, not a full HTML5 parser. It handles
  comments, quoted attributes and raw-text elements, which is everything this template
  uses. The post-render skeleton comparison backs it up.
- Overflow is measured in whole layout lines. Ink from ascenders and descenders that spills
  less than half a line past a line box is not counted as overflow, because tight line
  heights always do that a little.
- Visual quality beyond structure (contrast scoring, aesthetic balance) is out of scope.
  This is deliberately a structural validator.
- `lang="en"` is fixed, and all fixtures are English.

**Integration boundary.**

- **Upstream (Tasks 4 and 6):** this component consumes content that is already
  `approved`, together with its approval digest. It does not evaluate evidence or quality.
  The report has no G2 score, no evidence score and no engagement score, and a test
  asserts that.
- **Downstream:** consumers act on `report.status`. Only a `pass` produces `insight.png`.
- **Replaceable parts:**
  - the `Renderer` interface (`ChromiumRenderer` could become a remote render service)
  - the `TemplateBinder` interface
- **Audit (Task 8):** the report already records content, config, asset and PNG SHA-256s
  for audit records and replay.

## Assumptions

- Fixtures are synthetic: fictional providers, dated around the G2 fixture's
  `as_of` (6 Oct 2026). `approval.content_sha256` was stamped by
  `npm run approve -- <fixture>`, which stands in for the upstream review workflow. The
  changed-after-approval fixture was made by approving `normal` and then editing its body.
- "Approved text preserved" means byte-for-byte equality of `textContent` with the
  approved string, with no trimming or Unicode normalisation. CSS that changes what a
  reader sees (`text-transform`, generated content, ellipsis) counts as a change.
- `brand` in content is an identifier (`"atomity"`), not free text. Its visible form, the
  logo and its alt text, comes only from the design configuration.
