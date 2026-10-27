# Task 7 · single-insight-v1 — "Approved text in. A validated image out."

Seven captioned 1920 × 1080 films that walk a reviewer through the Task 7 submission: one overview, then one film per required check. *Every number, render and screen in them comes from the repository or the live Vercel showcase.*

---

## Why 7 films and not one

The Task 7 brief names six required checks: normal content, long title, long body, missing field, HTML/script input and changed approved text. A single walkthrough would rush all six. So each check gets its own film, built around the one visual idea that makes it obvious, and an overview ties them together.
Each film follows the same order. First the problem, in the reviewer's terms. Then what the component does about it, shown with the real artefact. Then the evidence: the real report, the real render, the live showcase. The captions are burned in, so every film works muted.

Every film runs the same narrative spine:

**Problem** → **Mechanism** → **Evidence** → **Live** → **Sign-off**

---

## The films

Each MP4 is in [`films/`](films), with a poster frame in [`posters/`](posters). They
also play on the live showcase at https://task-7-insight-template.vercel.app. Open
[`showreel.html`](showreel.html) locally for the stills and beats of every film.

| # | Film | Length | Audience | Opening line |
|---|------|--------|----------|--------------|
| 01 | [**Overview**](films/01-overview.mp4) | 36s | A reviewer meeting the submission for the first time | "Approved text should become an image exactly as approved." |
| 02 | [**Normal content**](films/02-normal-content.mp4) | 36s | A reviewer verifying required check 1 | "Four slots. Four approved strings. Nothing added." |
| 03 | [**Long title**](films/03-long-title.mp4) | 32s | A reviewer verifying required check 2 | "Some titles don't fit." |
| 04 | [**Long body**](films/04-long-body.mp4) | 34s | A reviewer verifying required check 3 | "When the body runs long, no word may vanish." |
| 05 | [**Missing field**](films/05-missing-field.mp4) | 32s | A reviewer verifying required check 4 | "A missing field is not a blank to fill in." |
| 06 | [**HTML and script input**](films/06-script-input.mp4) | 36s | A reviewer verifying required check 5 | "&lt;script>alert("test")&lt;/script> is approved text." |
| 07 | [**Changed approved text**](films/07-changed-text.mp4) | 37s | A reviewer verifying required check 6 | "42 became 47. Nobody approved that." |

### 01 — Overview
*The whole pipeline · Device: A conveyor through the five real pipeline stations, then a camera tour of the live showcase.*

Three ways it goes wrong (*a long title gets cut with …*, *a number changes after approval*, *&lt;script> in the copy runs*). A JSON card rides a conveyor through Contract, Bind, Render, Capture and Validate, and each station lights as it arrives. The card turns into the real normal render while the eight checks land as pass. Then the camera tours the deployed Vercel showcase.

**Audience:** A reviewer meeting the submission for the first time  
**CTA:** See the live showcase

### 02 — Normal content
*Required check 1 · normal content · Device: A dossier: each real fixture field flies into its slot on a wireframe of the template.*

The real *fixtures/normal.json* fields sit beside a wireframe of the template's measured regions. Title, body, source note and brand each fly into their slot. The wireframe becomes the real Chromium render. The eight checks land with their real measurements (*title 2 / 3 lines · body 204 of 312.5 px*). Two runs slide together and 0 pixels differ. On the live showcase, a cursor opens the normal card's checks.

**Audience:** A reviewer verifying required check 1  
**CTA:** See the live showcase

### 03 — Long title
*Required check 2 · long title · Device: A ruler and a three-line limit the title crosses.*

The usual fixes are struck out: *shrink the font*, *cut it off with an ellipsis*, *hide the overflow*. The real long title is typeset at exact scale against a ruler. Lines 4 to 6 cross the three-line limit in red, the counters reach *6 / 3 lines* and *+156 px*, and *TITLE_OVERFLOW* lands. The real *insight.failed.png* appears with the region and overflow drawn on it, and *insight.png* is shown as never written.

**Audience:** A reviewer verifying required check 2  
**CTA:** See the live showcase

### 04 — Long body
*Required check 3 · long body · Device: A vessel filling past capacity, with a gauge.*

*overflow: hidden*, *text-overflow: ellipsis* and *line-clamp* are struck out. The real long body pours into its 312.5 px region and keeps going, in red, past the canvas edge, never clipped. The gauge reaches *476 px* and *+163.5 px*. *BODY_OVERFLOW* lands next to *approved_text_preserved: pass*. The camera then pans over the live report.json on Vercel, and a test-suite template that hides the overflow is caught as *TEXT_CLIPPED*.

**Audience:** A reviewer verifying required check 3  
**CTA:** See the live showcase

### 05 — Missing field
*Required check 4 · missing field · Device: A 4 × 4 matrix of failure cases, then a gate the browser never passes.*

Three slots check out and *source_note* is absent. A matrix of every slot against every way to be missing (*absent, null, empty, whitespace*) fills red, one test case at a time: 16 / 16. A gate diagram shows *required_fields* stopping it before Chromium, with *0* renderer calls. On the live showcase the card reads *Not rendered* and its checks open to *required_fields: fail*.

**Audience:** A reviewer verifying required check 4  
**CTA:** See the live showcase

### 06 — HTML and script input
*Required check 5 · HTML and script-like input · Device: Split panes (labelled illustration against the real render), then five defence layers lighting up.*

The script tag types itself out: *is approved text, so it must appear as text*. On the left, a labelled illustration of what unescaped markup could do is stamped *PREVENTED*. On the right is the real render, where the markup is literal. Five independent layers light up in turn while the real report's counters hold at zero. A negative control with escaping switched off is still caught as *UNSAFE_MARKUP*.

**Audience:** A reviewer verifying required check 5  
**CTA:** See the live showcase

### 07 — Changed approved text
*Required check 6 · changed approved text · Device: A fingerprint diff: two SHA-256 digests compared character by character.*

A cursor edits *42* to *47* in the approved body. The digest recomputed at render time scrambles, then settles on the real value. A sweep compares it with the recorded digest character by character, and *APPROVAL_DIGEST_MISMATCH* lands with *refused before rendering*. Two more cases follow: a renderer that rewrites the number (*APPROVED_TEXT_CHANGED*, with the excerpt) and CSS that uppercases the title (*TEXT_ALTERED_BY_STYLE*). The film ends on the live report.json holding both digests.

**Audience:** A reviewer verifying required check 6  
**CTA:** See the live showcase

---

## Specification

| | |
|---|---|
| Frame | 1920 x 1080 · 30fps |
| Codec | H.264 High profile, level 4.2, yuv420p, limited-range bt709, faststart |
| Audio | none — by design |
| Copy | captions burned into the frame, so every film works muted |

## Suggested run order

Watch 01 first, then 02 to 07 in order: they follow the order of the required checks in the Task 7 brief.



---

## What is real and what needs sign-off

There are no testimonials, no quotes and no performance claims. Every figure on screen is copied from a committed `report.json` or from the test suite.

1. **Synthetic content.** "Fictional Provider A" and "Fictional Provider B" are the synthetic fixtures' own placeholder names. No real company, event or press release appears.
2. **One illustration.** Film 06's left pane (an alert dialog and two network requests) is an illustration of what unescaped markup could do. It is labelled "Illustration" on screen. Everything else is a real render, report or capture.
3. **Atomity assets.** The Atomity logo and fonts appear only as the design assets supplied with the challenge, inside the renders and the showcase. Each film ends with a note that it is a candidate submission, not an official Atomity film.

**Everything structural is real.** The renders are the committed `examples/*.png`. The check names, failure codes and measurements (6 / 3 lines, +156 px, +163.5 px, both SHA-256 digests) come from `examples/*/report.json`. The 16 missing-field cases and the negative controls are the actual tests. The site footage is a Chromium capture of the deployed showcase, made by `source/capture-footage.cjs`.

---

## Re-rendering and editing

There are no CSS animations and no timers anywhere in a scene. A film is a pure function `render(t)` that fully describes the frame at time `t`. That makes the films frame-exact to capture and easy to retime: move a number in the `T` block at the foot of a scene, and that beat moves with it.
Shared furniture (captions, the series tag, the browser-frame camera, the sign-off) lives in `source/film.js` and `source/film.css`. Brand tokens come from `design/atomity.css`, and the fonts are referenced in place from `design/fonts`.

```bash
# one-time: npm ci in the submission folder (Playwright), and an ffmpeg with libx264
# (pip install imageio-ffmpeg is enough). This checks both are found:
node source/tools.cjs

# preview a film in a browser, looping (click to restart, space to pause)
start source/scenes/01-overview.html     # Windows
open  source/scenes/01-overview.html     # macOS

# render everything (four at once)
node source/render.cjs --jobs 4

# one film, and a contact sheet of stills for review
node source/render.cjs 01
node source/shots.cjs 01 && node source/sheet.cjs 01

# regenerate showreel.html and this README from films.json
python source/thumbs.py && python source/build-deliverables.py
```

Shared across all films: `source/brand.css` and `source/brand.js` (the only
files to change per brand), `source/kit.css` (type scale, UI primitives) and
`source/kit.js` (easings, the masked line reveal, counters, the scripted cursor,
the caption and end-card builders).

To change aspect ratio, edit `--stage-w`/`--stage-h` in `source/brand.css`; the
renderer asks each page for its own size, so nothing else needs touching — but
check each scene's absolute y-positions still land.
