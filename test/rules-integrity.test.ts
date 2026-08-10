import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { evaluate, matches } from "../src/rules/evaluate.js";
import { loadRules } from "../src/rules/load.js";
import { FIXTURES_DIR, RULES_DIR } from "./helpers.js";

const rules = loadRules(RULES_DIR);

/**
 * rules/*.yaml is the file a contributor edits, and it is data, so a typo in it
 * fails silently: a rule that names a field or a value nothing produces simply
 * never matches, and the tool answers something else without complaining.
 *
 * This is the contract between what detectors emit and what rules may ask for.
 * Adding a value to a detector means adding it here, which is the point: the
 * vocabulary should be something somebody decided, not something that drifted.
 */
const VOCABULARY: Record<string, string[]> = {
  language: ["node", "python", "ruby", "go", "none"],
  framework: [
    "nextjs", "express", "fastify", "koa", "hono", "nestjs", "astro", "nuxt",
    "sveltekit", "remix", "flask", "django", "fastapi", "rails", "sinatra",
    "chi", "gin", "echo", "fiber", "static", "unknown",
  ],
  shape: ["service", "notebook", "static", "cli", "library", "script", "unknown"],
  apps: ["one", "several"],
  database: ["postgres", "mysql", "sqlite", "mongo", "none"],
  container: ["dockerfile", "compose", "none"],
  orchestration: ["kubernetes", "helm", "terraform", "none"],
  jobs: [
    "sidekiq", "resque", "delayed_job", "good_job", "solid_queue", "celery",
    "rq", "dramatiq", "huey", "bullmq", "bull", "agenda", "asynq", "machinery",
    "none",
  ],
  serverless_fit: ["fits", "blocked"],
  blocked_by: [
    "background_work", "held_connections", "long_running", "model_runtime",
    "heavy_runtime", "local_disk", "none",
  ],
  commercial: ["yes", "unclear"],
  assets: ["light", "heavy"],
  demand: ["none", "present"],
  ci: ["github-actions", "gitlab-ci", "circleci", "jenkins", "none"],
  scan: ["complete", "partial"],
};

const everyWhen = [
  ...rules.stages.map((rule) => ["stage", rule.id, rule.when] as const),
  ...rules.flags.map((rule) => ["flag", rule.id, rule.when] as const),
  ...rules.caveats.map((rule) => ["caveat", rule.id, rule.when] as const),
];

describe("rules can only ask for things detectors produce", () => {
  it("names no field that no detector emits", () => {
    for (const [kind, id, when] of everyWhen) {
      for (const field of Object.keys(when)) {
        expect(Object.keys(VOCABULARY), `${kind} "${id}"`).toContain(field);
      }
    }
  });

  it("names no value that no detector produces", () => {
    // The typo a contributor will make is database: [postgresql] rather than
    // [postgres]. It never matches, and nothing else goes wrong, so the rule
    // just quietly stops existing.
    for (const [kind, id, when] of everyWhen) {
      for (const [field, allowed] of Object.entries(when)) {
        for (const value of allowed) {
          expect(VOCABULARY[field], `${kind} "${id}" field ${field}`).toContain(value);
        }
      }
    }
  });

  it("has a vocabulary that the detectors actually agree with", () => {
    // The check above only catches drift in one direction. This one catches a
    // detector emitting something the vocabulary has never heard of.
    const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const fixture of fixtures) {
      const { profile } = analyze(join(FIXTURES_DIR, fixture));
      for (const [field, values] of Object.entries(profile.fields)) {
        const known = VOCABULARY[field];
        if (known === undefined) continue;
        for (const value of values) {
          expect(known, `${fixture} produced ${field}=${value}`).toContain(value);
        }
      }
    }
  });
});

describe("every rule can be reached", () => {
  it("has no stage rule shadowed by an earlier one", () => {
    // First match wins, so reordering rules or loosening an early "when" can
    // strand a later rule. A profile that satisfies a rule's own conditions
    // must select that rule, or the rule is dead.
    for (const rule of rules.stages) {
      const fields: Record<string, string[]> = {};
      for (const [field, allowed] of Object.entries(rule.when)) {
        fields[field] = [allowed[0] as string];
      }
      const selected = rules.stages.find((candidate) => matches(candidate.when, fields));
      expect(selected?.id, `stage "${rule.id}" is unreachable`).toBe(rule.id);
    }
  });

  it("gives every rule a unique id", () => {
    for (const group of [rules.stages, rules.flags, rules.caveats]) {
      const ids = group.map((rule) => rule.id);
      expect(new Set(ids).size, ids.join(", ")).toBe(ids.length);
    }
  });
});

describe("the voice of the rules", () => {
  const allProse = [
    ...rules.stages.flatMap((rule) => [rule.stage, rule.headroom, rule.tripwire]),
    ...rules.flags.map((rule) => rule.text),
    ...rules.caveats.map((rule) => rule.text),
    ...Object.values(rules.notes),
  ];

  it("never leaks an internal metric into what a founder reads", () => {
    for (const text of allProse) {
      expect(text, text).not.toMatch(/\b(CPU|vCPU|RPS|QPS|p50|p95|p99|IOPS|latency|throughput)\b/i);
    }
  });

  it("uses no dash this project bans", () => {
    for (const text of allProse) {
      expect(text, text).not.toMatch(new RegExp("[\\u2014\\u2013]"));
    }
  });

  it("never promises a free tier that a provider has withdrawn", () => {
    for (const text of allProse) {
      expect(text, text).not.toMatch(/\b(fly\.io|railway)\b/i);
    }
  });
});

/**
 * Every stage rule's rendered prose, pinned.
 *
 * Eight of the sixteen rules are reached by no fixture, so their prices were
 * free to change: a mutation moved one from $19-25/mo to $99-125/mo and the
 * whole suite stayed green. An order of magnitude typo in a product that speaks
 * only in dollars is the most expensive mistake available here.
 */
const STAGE_PROSE: Record<string, string> = {
  notebook: "There is nothing to host here. This is analysis, not a service.",
  library: "There is nothing to host here. This is a package other people install.",
  "command-line-tool": "There is nothing to host here. This is a tool people run on their own machines.",
  "model-runtime":
    "This is sized by the model it loads, not by how many people visit, so we will not put a price on it",
  "app-with-background-work":
    "One small server for the app, one for background work, and a managed database (est. $25-40/mo)",
  "static-site": "Free static hosting covers this (est. $0/mo)",
  "script-on-free-functions": "A free function tier covers this (est. $0/mo)",
  "commercial-app-on-managed-hosting":
    "Managed hosting on the cheapest paid plan, because this looks like a business (est. $20/mo)",
  "app-on-free-managed-hosting-with-database": "A free managed tier covers this, database included (est. $0/mo)",
  "app-on-free-managed-hosting": "A free managed tier covers this (est. $0/mo)",
  "app-with-managed-database": "One small server plus a managed database (est. $19-25/mo)",
  "app-with-file-database": "One small always on server (est. $4-9/mo)",
  "app-needing-a-server": "One small always on server (est. $4-9/mo)",
  "script-needing-a-server": "One small always on server, if you want this running somewhere (est. $4-9/mo)",
  "known-language-only": "We could not tell whether this is something you host, so we cannot price it",
  unknown: "We could not tell what this repository runs, so we cannot price it",
};

describe("every stage rule, priced", () => {
  it("covers all sixteen rules and no others", () => {
    expect(rules.stages.map((rule) => rule.id).sort()).toEqual(Object.keys(STAGE_PROSE).sort());
  });

  for (const rule of rules.stages) {
    it(`${rule.id} still says what it said`, () => {
      const fields: Record<string, string[]> = {};
      for (const [field, allowed] of Object.entries(rule.when)) {
        fields[field] = [allowed[0] as string];
      }
      const verdict = evaluate({ fields, confidence: {}, evidence: {} }, rules);
      expect(verdict.stage).toBe(STAGE_PROSE[rule.id]);
    });
  }

  it("quotes no price outside a plausible range", () => {
    // A guard against an order of magnitude typo, not against a wrong price.
    for (const rule of rules.stages) {
      const prose = [rule.stage, rule.headroom, rule.tripwire].join(" ");
      for (const match of prose.matchAll(/\$(\d+)/g)) {
        const dollars = Number(match[1]);
        expect(dollars, `stage "${rule.id}" quotes $${dollars}`).toBeLessThanOrEqual(500);
      }
    }
  });
});

describe("the closing sentence means something", () => {
  it("never affirms no action from a verdict that identified nothing", () => {
    // "Do nothing today." is this tool's signature line. Printing it under
    // "we could not tell what this repository runs" pairs an admission of
    // ignorance with confident approval of whatever is in there.
    for (const id of ["known-language-only", "unknown", "model-runtime"]) {
      const rule = rules.stages.find((candidate) => candidate.id === id);
      expect(rule?.doNothing, id).toBe(false);
    }
  });

  it("still allows it where the tool reached an answer", () => {
    for (const id of ["notebook", "library", "command-line-tool", "static-site"]) {
      const rule = rules.stages.find((candidate) => candidate.id === id);
      expect(rule?.doNothing, id).toBe(true);
    }
  });

  it("does not print it for a repository it could not identify", () => {
    const verdict = evaluate({ fields: { shape: ["unknown"] }, confidence: {}, evidence: {} }, rules);
    expect(verdict.flags).toEqual([]);
    expect(verdict.doNothingToday).toBe(false);
  });
});
