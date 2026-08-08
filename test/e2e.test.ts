import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
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

describe("the shipped rules are the ones it reads", () => {
  /**
   * resolveRulesDir tries "../rules/" then "../../rules/". Every other test in
   * this file runs the binary from inside the checkout, where the second
   * candidate finds the source rules/ directory. So a build that copied no
   * rules data, or stale data, would answer correctly here and fail on every
   * machine that is not this one.
   *
   * Copying dist somewhere with no checkout above it removes that fallback.
   */
  function isolatedDist(): string {
    const home = mkdtempSync(join(tmpdir(), "shiftpoint-iso-"));
    cpSync(join(REPO_ROOT, "dist"), join(home, "dist"), { recursive: true });
    cpSync(join(REPO_ROOT, "package.json"), join(home, "package.json"));
    // The one runtime dependency has to resolve. Linking it rather than
    // copying keeps this cheap, and leaves the point intact: there is no
    // rules/ directory above dist here, so the fallback cannot fire.
    symlinkSync(join(REPO_ROOT, "node_modules"), join(home, "node_modules"), "dir");
    return home;
  }

  it("answers with no source checkout anywhere above it", () => {
    const home = isolatedDist();
    try {
      const output = execFileSync(process.execPath, [join(home, "dist", "main.js"), join(FIXTURES_DIR, "static-site")], {
        encoding: "utf8",
      });
      expect(output).toContain("Free static hosting covers this (est. $0/mo)");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails loudly, rather than silently, when its rules data is missing", () => {
    const home = isolatedDist();
    try {
      // Only the data. dist/rules also holds the compiled engine, because the
      // build puts the rules next to the code that reads them.
      for (const name of readdirSync(join(home, "dist", "rules"))) {
        if (name.endsWith(".yaml")) rmSync(join(home, "dist", "rules", name));
      }
      let stderr = "";
      let code = 0;
      try {
        execFileSync(process.execPath, [join(home, "dist", "main.js"), join(FIXTURES_DIR, "static-site")], {
          stdio: "pipe",
        });
      } catch (error) {
        const failure = error as { status?: number; stderr?: Buffer };
        code = failure.status ?? 1;
        stderr = failure.stderr?.toString() ?? "";
      }
      expect(code).toBe(1);
      expect(stderr).toContain("Could not find the rules directory");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("ships an executable entry point with a shebang", () => {
    const entry = readFileSync(join(REPO_ROOT, "dist", "main.js"), "utf8");
    expect(entry.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
