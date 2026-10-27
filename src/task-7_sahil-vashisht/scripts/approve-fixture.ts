/**
 * Stamps a fixture's approval.content_sha256 with the digest of its current slots.
 *
 * This stands in for the upstream review workflow (Task 4), which would record the
 * digest when a human approves the content. It is a fixture-authoring tool only: the
 * renderer never calls it. The changed-after-approval fixture was made by approving
 * the normal content and then editing its body.
 *
 *   npm run approve -- fixtures/normal.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { approvalDigest } from "../src/approval.js";
import { ApprovedContentSchema, SLOT_NAMES, describeIssues, type CompleteContentSlots } from "../src/contracts.js";

for (const file of process.argv.slice(2)) {
  const parsed = ApprovedContentSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new Error(`${file}:\n  ${describeIssues(parsed.error).join("\n  ")}`);
  const fixture = parsed.data;
  if (SLOT_NAMES.some((slot) => typeof fixture.content[slot] !== "string")) {
    throw new Error(`${file}: every slot needs a value before it can be approved`);
  }
  fixture.approval.content_sha256 = approvalDigest(fixture.content as CompleteContentSlots);
  // Keep invisible characters (no-break space and friends) visible as \u escapes in the file.
  const json = JSON.stringify(fixture, null, 2).replace(
    /[\u00a0\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  await writeFile(file, `${json}\n`);
  console.log(`${file}: ${fixture.approval.content_sha256}`);
}
