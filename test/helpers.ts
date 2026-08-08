import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepo, type Repo } from "../src/scan/repo.js";

// Re-exported so a test can assert "every renderer survives this" without
// importing three modules to say it.
export { renderTerminal } from "../src/render/terminal.js";
export { renderMarkdown } from "../src/render/markdown.js";
export { renderJson } from "../src/render/json.js";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES_DIR = join(REPO_ROOT, "fixtures");
export const GOLDENS_DIR = join(REPO_ROOT, "goldens");
export const RULES_DIR = join(REPO_ROOT, "rules");

/** Builds a throwaway repository on disk, hands it over, then removes it. */
export function withRepo<T>(files: Record<string, string>, use: (repo: Repo, root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "shiftpoint-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return use(loadRepo(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function values(signals: { kind: string; values: string[] }[], kind: string): string[] {
  return signals.find((signal) => signal.kind === kind)?.values ?? [];
}
