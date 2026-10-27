import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./approval.js";
import type { AssetRecord, DesignConfig } from "./contracts.js";
import { resolveRepoPath } from "./paths.js";

export interface AllowedAsset {
  role: AssetRecord["role"];
  repoPath: string;
  file: string;
  contentType: string;
}

/**
 * Every file the render may touch. The renderer serves these, and only these, from a
 * virtual origin. Any other request is blocked and reported as UNEXPECTED_ASSET_REQUEST.
 */
export interface AssetPlan {
  records: AssetRecord[];
  /** Keyed by URL path ("/" + repo-relative path). */
  allowlist: Map<string, AllowedAsset>;
  missing: AssetRecord[];
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
};

/** Checks that each required asset exists, and records its hash so a reviewer can tell exactly which files were used. */
export async function planAssets(config: DesignConfig, brandId: string | null): Promise<AssetPlan> {
  const wanted: Array<[AssetRecord["role"], string]> = [
    ["template", config.template.html],
    ["template-stylesheet", config.template.stylesheet],
    ["design-stylesheet", config.design_foundation.stylesheet],
  ];
  const brand = brandId !== null && Object.hasOwn(config.brands, brandId) ? config.brands[brandId] : undefined;
  if (brand) wanted.push(["logo", brand.logo]);
  for (const font of new Set(config.design_foundation.fonts.map((f) => f.file))) wanted.push(["font", font]);

  const records: AssetRecord[] = [];
  const allowlist = new Map<string, AllowedAsset>();
  for (const [role, repoPath] of wanted) {
    const file = resolveRepoPath(repoPath);
    let digest: string | null = null;
    try {
      digest = sha256(await readFile(file));
    } catch {
      digest = null;
    }
    records.push({ role, path: repoPath, exists: digest !== null, sha256: digest, loaded: null });
    allowlist.set(`/${repoPath}`, {
      role,
      repoPath,
      file,
      contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    });
  }
  return { records, allowlist, missing: records.filter((r) => !r.exists) };
}
