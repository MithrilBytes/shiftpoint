import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { matches } from "../src/rules/evaluate.js";
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
    "rq", "dramatiq", "huey", "bullmq", "bull", "agenda", "none",
  ],
  serverless_fit: ["fits", "blocked"],
  blocked_by: ["background_work", "held_connections", "heavy_runtime", "local_disk", "none"],
  commercial: ["yes", "unclear"],
  assets: ["light", "heavy"],
  demand: ["none", "present"],
  ci: ["github-actions", "gitlab-ci", "circleci", "jenkins", "none"],
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
