import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { detectApps } from "../src/scan/apps.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { FIXTURES_DIR, GOLDENS_DIR, withRepo } from "./helpers.js";

/**
 * The goldens are the specification. They were written by hand before any
 * detector existed, and the tool has to reproduce them byte for byte.
 */
const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("goldens", () => {
  it("covers every fixture", () => {
    expect(fixtures).toEqual([
      "flask-sqlite",
      "jupyter-notebook",
      "k8s-overkill",
      "ml-inference",
      "monorepo",
      "nextjs-crud",
      "python-script",
      "rails-sidekiq",
      "static-site",
    ]);
  });

  for (const fixture of fixtures) {
    it(`${fixture} matches its golden`, () => {
      const verdict = analyze(join(FIXTURES_DIR, fixture)).verdict;
      const golden = readFileSync(join(GOLDENS_DIR, `${fixture}.md`), "utf8");
      expect(renderMarkdown(verdict)).toBe(golden);
    });
  }
});

describe("downward detection", () => {
  it("flags Kubernetes and Helm in a repository with no demand behind them", () => {
    const { verdict, profile } = analyze(join(FIXTURES_DIR, "k8s-overkill"));

    expect(profile.fields["orchestration"]).toEqual(["kubernetes", "helm"]);
    expect(profile.fields["demand"]).toEqual(["none"]);
    expect(verdict.flags).toHaveLength(2);
    expect(verdict.doNothingToday).toBe(false);
  });

  it("leaves Kubernetes alone once the repository shows demand", () => {
    const { verdict } = analyze(join(FIXTURES_DIR, "rails-sidekiq"));
    expect(verdict.flags).toEqual([]);
    expect(verdict.doNothingToday).toBe(true);
  });
});

describe("the free tier comes first", () => {
  it("prices a static site, a script, and a stateless service at zero", () => {
    for (const fixture of ["static-site", "python-script", "k8s-overkill"]) {
      const { verdict } = analyze(join(FIXTURES_DIR, fixture));
      expect(verdict.stage, fixture).toContain("$0/mo");
    }
  });

  it("refuses to price something that is not a service", () => {
    const { verdict, profile } = analyze(join(FIXTURES_DIR, "jupyter-notebook"));
    expect(profile.fields["shape"]).toEqual(["notebook"]);
    expect(verdict.stage).toContain("nothing to host here");
    expect(verdict.stage).not.toMatch(/\$/);
    expect(verdict.doNothingToday).toBe(true);
  });

  it("charges for a commercial app because the free plan does not license it", () => {
    const { verdict, profile } = analyze(join(FIXTURES_DIR, "nextjs-crud"));
    expect(profile.fields["commercial"]).toEqual(["yes"]);
    expect(verdict.stage).toContain("$20/mo");
    expect(verdict.tripwire).toContain("non commercial");
  });

  it("refuses to price a model runtime rather than quoting a server that cannot load it", () => {
    const { verdict, profile } = analyze(join(FIXTURES_DIR, "ml-inference"));
    expect(profile.fields["blocked_by"]).toContain("heavy_runtime");
    expect(verdict.stage).toContain("sized by the model");
    expect(verdict.stage).not.toMatch(/\$/);
  });

  it("says so when one verdict is covering several applications", () => {
    const { verdict, profile } = analyze(join(FIXTURES_DIR, "monorepo"));
    expect(profile.fields["apps"]).toEqual(["several"]);
    expect(verdict.confidenceNote).toContain("more than one deployable application");
  });

  it("does not treat a nested checkout as a second application", () => {
    // A git worktree or submodule carries a full copy of a repository. Walking
    // into one makes a single app look like a monorepo.
    withRepo(
      {
        "package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        ".claude/worktrees/copy/.git": "gitdir: /elsewhere/.git/worktrees/copy",
        ".claude/worktrees/copy/package.json": JSON.stringify({ dependencies: { next: "^14" } }),
      },
      (repo) => {
        expect(detectApps(repo)[0]?.metric).toBe(1);
      },
    );
  });

  it("sends work that needs a live process to a real server", () => {
    for (const fixture of ["flask-sqlite", "rails-sidekiq"]) {
      const { verdict, profile } = analyze(join(FIXTURES_DIR, fixture));
      expect(profile.fields["serverless_fit"], fixture).toEqual(["blocked"]);
      expect(verdict.stage, fixture).not.toContain("$0/mo");
    }
  });
});
