/**
 * Builds the static showcase that is deployed to Vercel: a gallery of the committed example
 * renders and their validation reports.
 *
 * It renders nothing itself. PNGs come only from the Node + Playwright pipeline
 * (npm run examples). It needs no npm install, so a static host can run it as is.
 *
 *   node scripts/build-site.mjs   ->  dist/
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUBMISSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SUBMISSION, "..", "..");
const DIST = path.join(SUBMISSION, "dist");
const SUBMISSION_PATH = path.relative(REPO, SUBMISSION).split(path.sep).join("/");
const SOURCE_URL = `https://github.com/sahil00000001/engineering-challenge/tree/task-7_sahil-vashisht/${SUBMISSION_PATH}`;

// Keep the repository layout, so every relative link in the saved insight.html files
// (template -> ../../../design/atomity.css) resolves exactly as it does on disk.
await rm(DIST, { recursive: true, force: true });
await cp(path.join(REPO, "design"), path.join(DIST, "design"), { recursive: true });
for (const dir of ["template", "examples", "fixtures", "config", "schemas"]) {
  await cp(path.join(SUBMISSION, dir), path.join(DIST, SUBMISSION_PATH, dir), { recursive: true });
}
await cp(path.join(SUBMISSION, "site", "site.css"), path.join(DIST, "site.css"));

/**
 * @typedef {{ fixture: string, purpose: string | null, content_id: string | null, status: "pass" | "fail",
 *   checks: Record<string, string>, failure_codes: string[], png: string | null, html: string | null, report: string }} ExampleEntry
 */

/** @type {ExampleEntry[]} */
const examples = JSON.parse(await readFile(path.join(SUBMISSION, "examples", "index.json"), "utf8"));
const design = JSON.parse(await readFile(path.join(SUBMISSION, "config", "single-insight-v1.design.json"), "utf8"));
const normal = examples.find((e) => e.fixture === "normal");
if (!normal?.png) throw new Error("examples/index.json has no passing normal render; run npm run examples first");
const normalContent = JSON.parse(await readFile(path.join(SUBMISSION, "fixtures", "normal.json"), "utf8"));

/** @type {Record<string, string>} */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** @param {unknown} value */
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
/**
 * Escapes, then turns `backticked` spans into <code>.
 * @param {string} value
 */
const prose = (value) => esc(value).replace(/`([^`]+)`/g, "<code>$1</code>");
/** @param {string} file */
const at = (file) => `${SUBMISSION_PATH}/${file}`;

/** @type {Record<string, string>} */
const CHECK_LABELS = {
  input_contract: "Input contract",
  required_fields: "Required fields",
  assets: "Assets",
  canvas: "Canvas size",
  content_present: "Content present",
  overflow: "Overflow",
  approved_text_preserved: "Approved text preserved",
  safe_binding: "Safe binding",
};

/** @param {ExampleEntry} example */
function exampleCard(example) {
  const media = example.png
    ? `<a class="example__media" href="${esc(at(`examples/${example.png}`))}"><img src="${esc(at(`examples/${example.png}`))}" width="${design.canvas.width}" height="${design.canvas.height}" loading="lazy" alt="Render of the ${esc(example.fixture)} fixture${example.status === "fail" ? ", kept for diagnosis because validation failed" : ""}"></a>`
    : `<div class="example__media example__media--empty"><p>Not rendered. This content never reached the browser.</p></div>`;
  const checks = Object.entries(example.checks)
    .map(([name, status]) => `<li><span>${esc(CHECK_LABELS[name] ?? name)}</span><span class="chip chip--${status === "pass" ? "pass" : status === "fail" ? "fail" : "neutral"}">${esc(status)}</span></li>`)
    .join("");
  const codes = example.failure_codes.length ? example.failure_codes.map((c) => `<code>${esc(c)}</code>`).join(" ") : "None";
  const links = [
    `<a href="${esc(at(`fixtures/${example.fixture}.json`))}">Input</a>`,
    `<a href="${esc(at(`examples/${example.report}`))}">report.json</a>`,
    example.html ? `<a href="${esc(at(`examples/${example.html}`))}">Rendered HTML</a>` : null,
  ].filter(Boolean);
  return `
      <article class="example card">
        ${media}
        <div class="example__body">
          <div class="example__head">
            <h3 class="example__name">${esc(example.fixture)}</h3>
            <span class="chip chip--${example.status === "pass" ? "pass" : "fail"}">${esc(example.status)}</span>
          </div>
          <p class="example__purpose">${prose(example.purpose ?? "")}</p>
          <p class="example__codes"><span class="micro-label">Failure codes</span> ${codes}</p>
          <details class="example__checks">
            <summary>Checks</summary>
            <ul>${checks}</ul>
          </details>
          <p class="example__links">${links.join('<span aria-hidden="true"> · </span>')}</p>
        </div>
      </article>`;
}

const passed = examples.filter((e) => e.status === "pass").length;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Single insight template: Task 7 submission</title>
  <meta name="description" content="Engineering challenge submission: approved content rendered into a reusable HTML/CSS template, captured as a PNG by headless Chromium and checked by a separate visual-validation report.">
  <link rel="stylesheet" href="design/atomity.css">
  <link rel="stylesheet" href="site.css">
</head>
<body>
  <header class="site-header">
    <div class="container site-header__inner">
      <img class="site-header__logo" src="design/atomity_logo.svg" alt="Atomity">
      <span class="micro-label">Engineering challenge · Task 7</span>
      <a class="site-header__link" href="${esc(SOURCE_URL)}">Source on GitHub</a>
    </div>
  </header>

  <main class="container">
    <section class="hero">
      <p class="eyebrow">Evidence-to-Insight · One visual template</p>
      <h1 class="hero__title">Approved content in. A validated ${design.canvas.width} × ${design.canvas.height} insight image out.</h1>
      <p class="hero__lead">One reusable HTML/CSS template built on the Atomity design tokens. Approved text is bound as escaped text only, rendered by headless Chromium with page JavaScript off, captured as a PNG, then checked by a separate visual-validation report. That report covers required fields, overflow, exact text preservation, assets, canvas size and safe binding.</p>
    </section>

    <figure class="featured">
      <img src="${esc(at(`examples/${normal.png}`))}" width="${design.canvas.width}" height="${design.canvas.height}" alt="Rendered insight image. Title: ${esc(normalContent.content.title)}">
      <figcaption>
        <span class="chip chip--pass">pass</span>
        <span>The <code>normal</code> fixture, rendered from <a href="${esc(at("fixtures/normal.json"))}">approved content</a> and the <a href="${esc(at("config/single-insight-v1.design.json"))}">design configuration</a>. <a href="${esc(at(`examples/${normal.report}`))}">Validation report</a> · <a href="${esc(at(`examples/${normal.html}`))}">HTML representation</a></span>
      </figcaption>
    </figure>

    <section class="section-block" aria-labelledby="pipeline-title">
      <h2 class="section-title" id="pipeline-title">How one render works</h2>
      <ol class="pipeline">
        <li><span class="pipeline__step">01</span><strong>Contract</strong><span>Typed input. Every slot must be present, and the text must match its approval digest.</span></li>
        <li><span class="pipeline__step">02</span><strong>Bind</strong><span>Context-checked, single-pass HTML escaping. Content only ever becomes element text.</span></li>
        <li><span class="pipeline__step">03</span><strong>Render</strong><span>Chromium with JavaScript off, a hash-pinned CSP and an asset allowlist on a <code>.invalid</code> origin.</span></li>
        <li><span class="pipeline__step">04</span><strong>Capture</strong><span>A ${design.canvas.width} × ${design.canvas.height} PNG, after fonts and the logo have loaded.</span></li>
        <li><span class="pipeline__step">05</span><strong>Validate</strong><span>The live DOM and the pixels are measured against the approved text and the layout regions.</span></li>
      </ol>
    </section>

    <section class="section-block" aria-labelledby="examples-title">
      <h2 class="section-title" id="examples-title">Every fixture, every outcome</h2>
      <p class="section-lead">${passed} of ${examples.length} fixtures are meant to pass. The rest prove a failure is caught and explained instead of shipped. Failed renders are kept as <code>insight.failed.png</code>, never as <code>insight.png</code>.</p>
      <div class="gallery">${examples.map(exampleCard).join("")}
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>A candidate submission for the Atomity engineering challenge. It is not an official Atomity site. All content is synthetic test data about fictional providers. The Atomity logo, fonts and stylesheet are the design assets supplied with the challenge, used unmodified. This page is generated from the committed examples by <code>scripts/build-site.mjs</code>.</p>
    </div>
  </footer>
</body>
</html>
`;

await writeFile(path.join(DIST, "index.html"), html);
console.log(`Built ${path.relative(process.cwd(), DIST)} with ${examples.length} examples`);
