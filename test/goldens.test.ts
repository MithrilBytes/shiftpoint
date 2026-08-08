import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { FIXTURES_DIR, GOLDENS_DIR } from "./helpers.js";

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
      "k8s-overkill",
      "nextjs-crud",
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
