import path from "node:path";
import { fileURLToPath } from "node:url";

/** This submission's folder (src/task-7_sahil-vashisht). */
export const SUBMISSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The challenge repository root. design/ is read from here in place, never copied. */
export const REPO_ROOT = path.resolve(SUBMISSION_DIR, "..", "..");

export const DEFAULT_CONFIG_PATH = path.join(SUBMISSION_DIR, "config", "single-insight-v1.design.json");

/**
 * Resolves a repository-relative POSIX path (as written in the design config) to an
 * absolute path. The config schema already refuses ".." segments; this is the second
 * guard, so a path can never resolve outside the repository.
 */
export function resolveRepoPath(repoPath: string, root: string = REPO_ROOT): string {
  const absolute = path.resolve(root, ...repoPath.split("/"));
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the repository: ${repoPath}`);
  }
  return absolute;
}

/** Repository-relative POSIX form of an absolute path, for portable reports. */
export function toRepoRelative(absolutePath: string, root: string = REPO_ROOT): string {
  const relative = path.relative(root, absolutePath);
  return relative.startsWith("..") || path.isAbsolute(relative) ? absolutePath : relative.split(path.sep).join("/");
}
