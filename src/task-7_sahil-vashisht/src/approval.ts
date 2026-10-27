import { createHash } from "node:crypto";
import type { CompleteContentSlots } from "./contracts.js";

/**
 * Digest of the approved slot values, recorded upstream when the content is approved
 * (the review workflow, Task 4, is out of scope here).
 *
 * Canonical form: JSON of {brand, title, body, source_note} in that key order, no
 * whitespace, UTF-8, SHA-256, lowercase hex. No Unicode normalisation or trimming is
 * applied, because any change to the approved bytes must change the digest.
 */
export function approvalDigest(slots: CompleteContentSlots): string {
  const canonical = JSON.stringify({
    brand: slots.brand,
    title: slots.title,
    body: slots.body,
    source_note: slots.source_note,
  });
  return sha256(canonical);
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
