import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

/**
 * shiftpoint does not go to the npm registry. That is a decision, not a
 * not-yet, so it is enforced here rather than remembered.
 *
 * Publishing is the one action in this project that cannot be undone: a version
 * number can never be reused and unpublishing is restricted after 72 hours. A
 * guard that depends on nobody typing the wrong command is not a guard.
 */

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  private?: boolean;
  scripts?: Record<string, string>;
  files?: string[];
};

describe("this package is not published", () => {
  it("is marked private", () => {
    expect(manifest.private).toBe(true);
  });

  it("runs the refusal on prepublishOnly", () => {
    expect(manifest.scripts?.["prepublishOnly"]).toContain("guard-publish");
  });

  it("refuses no matter what the environment says", () => {
    // An earlier version of the guard had an environment variable escape
    // hatch. A documented way to do the thing that must never happen is not a
    // guard, so there is no way through this one.
    for (const env of [{}, { SHIFTPOINT_ALLOW_PUBLISH: "1" }, { npm_config_dry_run: "true" }]) {
      let code = 0;
      try {
        execFileSync(process.execPath, [join(REPO_ROOT, "scripts", "guard-publish.mjs")], {
          env: { ...process.env, ...env },
          stdio: "pipe",
        });
      } catch (error) {
        code = (error as { status?: number }).status ?? 1;
      }
      expect(code, `env ${JSON.stringify(env)}`).toBe(1);
    }
  });

  it("does not document an install path that will never exist", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).not.toMatch(/npx\s+shiftpoint/);
    expect(readme).not.toMatch(/npm\s+install\s+(-g|--global)\s+shiftpoint/);
  });
});
