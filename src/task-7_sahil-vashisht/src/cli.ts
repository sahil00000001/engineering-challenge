import path from "node:path";
import { parseArgs } from "node:util";
import { CHECK_NAMES } from "./contracts.js";
import { SUBMISSION_DIR } from "./paths.js";
import { loadDesignConfig, readContentFile, renderInsight } from "./pipeline.js";
import { ChromiumRenderer } from "./renderer.js";

const USAGE = `Render approved content into the single-insight template.

Usage:
  npm run render -- <content.json> [--out <dir>] [--config <design.json>]

Writes report.json, insight.html and either insight.png (pass) or insight.failed.png (fail).
Default output folder: out/<content file name>/

Exit codes: 0 pass, 1 visual validation failed (see report.json), 2 usage or configuration error.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const contentFile = path.resolve(positionals[0]!);
  const outDir = path.resolve(values.out ?? path.join(SUBMISSION_DIR, "out", path.basename(contentFile, ".json")));
  const design = await loadDesignConfig(values.config ? path.resolve(values.config) : undefined);

  const renderer = await ChromiumRenderer.launch();
  try {
    const { report, files } = await renderInsight(await readContentFile(contentFile), { design, renderer, outDir });
    console.log(`${report.template.id} · ${report.content_id ?? "(invalid content)"} → ${report.status.toUpperCase()}`);
    for (const name of CHECK_NAMES) console.log(`  ${name.padEnd(24)} ${report.checks[name]}`);
    for (const f of report.failures) console.log(`  ✗ ${f.code}${f.slot ? ` [${f.slot}]` : ""}: ${f.message}`);
    console.log(`  report: ${path.relative(process.cwd(), files.report)}`);
    if (files.png) console.log(`  png:    ${path.relative(process.cwd(), files.png)}`);
    if (files.html) console.log(`  html:   ${path.relative(process.cwd(), files.html)}`);
    return report.status === "pass" ? 0 : 1;
  } finally {
    await renderer.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(2);
  },
);
