import { describe, expect, it } from "vitest";
import { detectCommercial, PROCESSOR_BY_DEPENDENCY } from "../src/scan/commercial.js";
import { detectDatabase, ENGINE_BY_ALIAS } from "../src/scan/database.js";
import { detectFramework, FRAMEWORK_BY_DEPENDENCY } from "../src/scan/framework.js";
import { detectJobs, QUEUE_BY_DEPENDENCY } from "../src/scan/jobs.js";
import { detectServerless, HEAVY_RUNTIME, PERSISTENT_CONNECTION } from "../src/scan/serverless.js";
import { values, withRepo } from "./helpers.js";

/**
 * Every entry in every lookup table, exercised.
 *
 * A mutation pass deleted single entries from these maps one at a time and the
 * suite stayed green 44 times, because only the handful of names a fixture
 * happens to use were pinned. Deleting eight together turned eight correct
 * verdicts into "A free managed tier covers this (est. $0/mo)" with no flags,
 * which is the worst thing this tool can do: confidently wrong in the direction
 * that costs the owner money.
 *
 * These walk the tables themselves, so adding an entry without covering it is
 * not possible.
 */

/** Puts a dependency name into whichever manifest would plausibly carry it. */
function manifestsFor(name: string): Array<Record<string, string>> {
  return [
    { "package.json": JSON.stringify({ dependencies: { [name]: "^1.0.0" } }) },
    { "requirements.txt": `${name}==1.0.0\n` },
    { Gemfile: `source "https://rubygems.org"\ngem "${name}"\n` },
    { "go.mod": `module example.com/a\n\ngo 1.22\n\nrequire github.com/example/${name} v1.0.0\n` },
  ];
}

/** True when the detector produces `expected` from at least one manifest form. */
function reachedFromSomeManifest(
  name: string,
  detect: (repo: Parameters<typeof detectFramework>[0]) => ReturnType<typeof detectFramework>,
  kind: string,
  expected: string,
): boolean {
  return manifestsFor(name).some((files) =>
    withRepo(files, (repo) => values(detect(repo), kind).includes(expected)),
  );
}

describe("every framework in the table is detectable", () => {
  for (const [dependency, framework] of FRAMEWORK_BY_DEPENDENCY) {
    it(`${dependency} yields ${framework}`, () => {
      expect(reachedFromSomeManifest(dependency, detectFramework, "framework", framework)).toBe(true);
    });
  }
});

describe("every database alias in the table is detectable", () => {
  for (const [alias, engine] of ENGINE_BY_ALIAS) {
    it(`${alias} yields ${engine}`, () => {
      expect(reachedFromSomeManifest(alias, detectDatabase, "database", engine)).toBe(true);
    });
  }
});

describe("every queue library in the table is detectable", () => {
  for (const [dependency, queue] of QUEUE_BY_DEPENDENCY) {
    it(`${dependency} yields ${queue}`, () => {
      expect(reachedFromSomeManifest(dependency, detectJobs, "jobs", queue)).toBe(true);
    });
  }
});

describe("every serverless blocker in the table blocks", () => {
  for (const dependency of PERSISTENT_CONNECTION) {
    it(`${dependency} blocks on held connections`, () => {
      const blocked = manifestsFor(dependency).some((files) =>
        withRepo(files, (repo) => {
          const signals = detectServerless(repo);
          return (
            values(signals, "serverless_fit").includes("blocked") &&
            values(signals, "blocked_by").includes("held_connections")
          );
        }),
      );
      expect(blocked).toBe(true);
    });
  }

  for (const dependency of HEAVY_RUNTIME) {
    it(`${dependency} blocks on a heavy runtime`, () => {
      const blocked = manifestsFor(dependency).some((files) =>
        withRepo(files, (repo) => {
          const signals = detectServerless(repo);
          return (
            values(signals, "serverless_fit").includes("blocked") &&
            values(signals, "blocked_by").includes("heavy_runtime")
          );
        }),
      );
      expect(blocked).toBe(true);
    });
  }
});

describe("every payment processor in the table reads as commercial", () => {
  for (const [dependency] of PROCESSOR_BY_DEPENDENCY) {
    it(`${dependency} yields commercial`, () => {
      expect(reachedFromSomeManifest(dependency, detectCommercial, "commercial", "yes")).toBe(true);
    });
  }
});

describe("a dependency only counts where it actually runs", () => {
  it("ignores a browser automation tool that is only used for tests", () => {
    // playwright in devDependencies is a test runner. Reading it as a runtime
    // told an ordinary Express app it was sized by a machine learning model.
    withRepo(
      {
        "package.json": JSON.stringify({
          private: true,
          dependencies: { express: "^4" },
          devDependencies: { playwright: "^1.45" },
        }),
      },
      (repo) => {
        expect(values(detectServerless(repo), "serverless_fit")).toEqual(["fits"]);
      },
    );
  });

  it("still blocks when the same tool is a production dependency", () => {
    withRepo(
      { "package.json": JSON.stringify({ private: true, dependencies: { express: "^4", playwright: "^1.45" } }) },
      (repo) => {
        expect(values(detectServerless(repo), "blocked_by")).toContain("heavy_runtime");
      },
    );
  });
});
