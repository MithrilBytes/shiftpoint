import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURES_DIR, GOLDENS_DIR, REPO_ROOT } from "./helpers.js";

/**
 * The other suites exercise the library. This one runs the artifact that
 * actually ships: the built CLI, reading the rules copied into dist.
 */

const CLI = join(REPO_ROOT, "dist", "main.js");

const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "pipe" });
}, 180_000);

describe("the built CLI", () => {
  for (const fixture of fixtures) {
    it(`writes ${fixture}'s golden INFRA.md`, () => {
      const root = mkdtempSync(join(tmpdir(), "shiftpoint-e2e-"));
      try {
        cpSync(join(FIXTURES_DIR, fixture), root, { recursive: true });
        execFileSync(process.execPath, [CLI, root, "--write"], { stdio: "pipe" });
        expect(readFileSync(join(root, "INFRA.md"), "utf8")).toBe(
          readFileSync(join(GOLDENS_DIR, `${fixture}.md`), "utf8"),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("analyzes the current directory when given no path", () => {
    const output = execFileSync(process.execPath, [CLI], {
      cwd: join(FIXTURES_DIR, "static-site"),
      encoding: "utf8",
    });
    expect(output).toContain("Stage:    Free static hosting covers this (est. $0/mo)");
    expect(output.trimEnd().endsWith("Do nothing today.")).toBe(true);
  });

  it("exits non zero on a path that is not there", () => {
    expect(() =>
      execFileSync(process.execPath, [CLI, join(tmpdir(), "shiftpoint-absent")], { stdio: "pipe" }),
    ).toThrow();
  });
});

describe("the built output stands on its own", () => {
  // Nothing is published, but this still proves dist carries its own rules
  // data and that a clone builds to something runnable on another machine.
  it("packs only dist, README, LICENSE, and package.json", () => {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [tarball] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const paths = (tarball?.files ?? []).map((file) => file.path);
    expect([...new Set(paths.map((path) => path.split("/")[0]))].sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist",
      "package.json",
    ]);
    expect(paths).toContain("dist/rules/stages.yaml");
  });
});
