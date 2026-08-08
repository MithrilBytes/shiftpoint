import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * A read only view of the repository being analyzed. Every path is relative to
 * the repository root and uses forward slashes on every platform, so detectors
 * can match on paths with plain regular expressions.
 */
export interface Repo {
  root: string;
  files: readonly string[];
  has(path: string): boolean;
  read(path: string): string | undefined;
  bytes(path: string): number;
  matching(pattern: RegExp): string[];
}

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "coverage",
  ".terraform",
  ".cache",
  // Sample and test material. Code in here is written to exercise something
  // else, so it describes no deployment of its own. Reading it makes one
  // application look like several and lets a fixture's dependencies stand in
  // for the repository's own.
  "fixtures",
  "__fixtures__",
  "testdata",
  "test-data",
  "testfixtures",
  "examples",
  "example",
  "samples",
  "__mocks__",
  // Vendored third party source. A checked in dependency tree describes what
  // somebody else built, and reading it lets a vendored driver set the price.
  "site-packages",
  "third_party",
  "bower_components",
  "Pods",
]);

// A directory holding one of these is a dependency tree, whatever it is called.
// Virtual environments are routinely named env/ or .env39/ rather than venv/.
const VENDORED_MARKERS = ["pyvenv.cfg", "site-packages"];

// Engineering guards, not capacity priors. These keep a pathological
// repository from stalling the run; they never influence a verdict.
const MAX_READ_BYTES = 1_000_000;
const MAX_FILES = 20_000;

export function loadRepo(root: string): Repo {
  const sizes = new Map<string, number>();
  walk(root, root, sizes);

  const files = [...sizes.keys()].sort();
  const cache = new Map<string, string | undefined>();

  return {
    root,
    files,
    has: (path) => sizes.has(path),
    bytes: (path) => sizes.get(path) ?? 0,
    read(path) {
      if (cache.has(path)) return cache.get(path);
      let text: string | undefined;
      const size = sizes.get(path);
      if (size !== undefined && size <= MAX_READ_BYTES) {
        try {
          text = readFileSync(join(root, path), "utf8");
        } catch {
          text = undefined;
        }
      }
      cache.set(path, text);
      return text;
    },
    matching: (pattern) => files.filter((file) => pattern.test(file)),
  };
}

function walk(root: string, dir: string, sizes: Map<string, number>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (sizes.size >= MAX_FILES) return;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      // A subdirectory with its own .git is a separate checkout: a submodule,
      // a git worktree, or a vendored clone. Its files belong to that
      // repository, not this one, and counting them makes one application
      // look like several.
      if (existsSync(join(full, ".git"))) continue;
      if (VENDORED_MARKERS.some((marker) => existsSync(join(full, marker)))) continue;
      walk(root, full, sizes);
      continue;
    }

    // A symlink to a file is followed, because pnpm workspaces and Nix style
    // layouts symlink manifests and skipping them hid the whole project. A
    // symlink to a directory is not, which is what keeps the walk acyclic.
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    try {
      const stats = statSync(full);
      if (!stats.isFile()) continue;
      sizes.set(toPosix(relative(root, full)), stats.size);
    } catch {
      continue;
    }
  }
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
