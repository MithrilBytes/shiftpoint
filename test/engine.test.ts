import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, fill, matches } from "../src/engine/evaluate.js";
import { loadRules, type RuleSet } from "../src/engine/load.js";
import { buildProfile } from "../src/profile.js";
import type { Profile, Signal } from "../src/types.js";
import { RULES_DIR } from "./helpers.js";

const rules = loadRules(RULES_DIR);

function profileOf(fields: Record<string, string[]>, confidence: Record<string, string> = {}): Profile {
  return {
    fields,
    confidence: confidence as Profile["confidence"],
    evidence: {},
  };
}

describe("matches", () => {
  it("requires every key and accepts any listed value", () => {
    const fields = { framework: ["nextjs"], database: ["postgres"] };
    expect(matches({ framework: ["nextjs", "express"] }, fields)).toBe(true);
    expect(matches({ framework: ["nextjs"], database: ["mysql"] }, fields)).toBe(false);
    expect(matches({ jobs: ["sidekiq"] }, fields)).toBe(false);
  });

  it("matches everything when the when block is empty", () => {
    expect(matches({}, {})).toBe(true);
  });

  it("matches a field that carries several values", () => {
    expect(matches({ orchestration: ["helm"] }, { orchestration: ["kubernetes", "helm"] })).toBe(true);
  });
});

describe("fill", () => {
  it("substitutes scalars from the same rule", () => {
    expect(fill("est. ${cost_low}-{cost_high}/mo", { cost_low: "12", cost_high: "20" }, "test")).toBe(
      "est. $12-20/mo",
    );
  });

  it("names the rule when a placeholder has no value", () => {
    expect(() => fill("~{missing}", {}, 'rules/stages.yaml: stage "x"')).toThrow(
      /rules\/stages.yaml: stage "x" uses \{missing\} but defines no missing/,
    );
  });
});

describe("evaluate", () => {
  it("takes the first matching stage rule", () => {
    const verdict = evaluate(profileOf({ shape: ["static"] }), rules);
    expect(verdict.stage).toContain("Free static hosting");
  });

  it("never reports more confidence than the signals it leaned on", () => {
    const fields = { shape: ["service"], serverless_fit: ["fits"], payments: ["stripe"] };
    const strong = evaluate(
      profileOf(fields, { shape: "high", serverless_fit: "high", payments: "high" }),
      rules,
    );
    const weak = evaluate(
      profileOf(fields, { shape: "high", serverless_fit: "low", payments: "high" }),
      rules,
    );
    expect(strong.confidence).toBe("high");
    expect(weak.confidence).toBe("low");
    expect(weak.confidenceNote).toContain("Confidence: low.");
  });

  it("treats a signal it has no confidence for as low", () => {
    expect(evaluate(profileOf({ shape: ["static"] }), rules).confidence).toBe("low");
  });

  it("says to do nothing when there is nothing to remove", () => {
    const verdict = evaluate(profileOf({ shape: ["static"] }), rules);
    expect(verdict.flags).toEqual([]);
    expect(verdict.doNothingToday).toBe(true);
  });

  it("stops saying do nothing once a flag fires", () => {
    const verdict = evaluate(
      profileOf({ shape: ["service"], serverless_fit: ["fits"], orchestration: ["kubernetes"], demand: ["none"] }),
      rules,
    );
    expect(verdict.flags).toHaveLength(1);
    expect(verdict.doNothingToday).toBe(false);
  });

  it("falls through to a plainly low confidence answer when nothing is recognized", () => {
    const verdict = evaluate(profileOf({ shape: ["unknown"], language: ["none"] }), rules);
    expect(verdict.confidence).toBe("low");
    expect(verdict.stage).toContain("could not tell");
  });

  it("never quotes a price for something that is not a service", () => {
    for (const shape of ["notebook", "library", "cli"]) {
      const verdict = evaluate(profileOf({ shape: [shape] }), rules);
      expect(verdict.stage, shape).toContain("nothing to host here");
      expect(verdict.stage, shape).not.toMatch(/\$/);
    }
  });

  it("explains itself when no stage rule matches", () => {
    const empty: RuleSet = { ...rules, stages: [{ ...rules.stages[0]!, when: { framework: ["nothing"] } }] };
    expect(() => evaluate(profileOf({}), empty)).toThrow(/when: \{\}/);
  });
});

describe("shipped rules", () => {
  it("keeps every number out of the engine and inside the data", () => {
    for (const stage of rules.stages) {
      for (const text of [stage.stage, stage.headroom, stage.tripwire]) {
        expect(() => fill(text, stage.scalars, stage.id)).not.toThrow();
      }
    }
    for (const flag of rules.flags) {
      expect(() => fill(flag.text, flag.scalars, flag.id)).not.toThrow();
    }
  });

  it("ends with a rule that matches every repository", () => {
    expect(rules.stages[rules.stages.length - 1]?.when).toEqual({});
  });

  it("only flags spending that has no demand behind it", () => {
    for (const flag of rules.flags) {
      expect(flag.when["demand"]).toEqual(["none"]);
    }
  });

  // The first version of this file shipped prices that were invented. A price
  // without a source is a guess, and a guess here is the whole product being
  // wrong, so sourcing is enforced rather than trusted.
  it("cites a source for every rule that quotes a dollar figure", () => {
    const quotesMoney = (text: string): boolean => /\$\{?\w/.test(text);

    for (const stage of rules.stages) {
      const prose = [stage.stage, stage.headroom, stage.tripwire].join(" ");
      if (!quotesMoney(prose)) continue;
      expect(stage.scalars["source"], `stage "${stage.id}" quotes money`).toMatch(/read \d{4}-\d{2}-\d{2}/);
    }

    for (const flag of rules.flags) {
      if (!quotesMoney(flag.text)) continue;
      expect(flag.scalars["source"], `flag "${flag.id}" quotes money`).toMatch(/read \d{4}-\d{2}-\d{2}/);
    }
  });

  it("starts the ladder at zero rather than at a rented server", () => {
    const free = rules.stages.filter((stage) => stage.stage.includes("$0/mo"));
    expect(free.length).toBeGreaterThanOrEqual(3);
  });
});

describe("loadRules", () => {
  it("names the file and the rule when data is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "shiftpoint-rules-"));
    try {
      writeFileSync(join(dir, "stages.yaml"), "stages:\n  - id: broken\n    when: {}\n    confidence: high\n");
      writeFileSync(join(dir, "flags.yaml"), "flags: []\n");
      writeFileSync(join(dir, "profile.yaml"), "thresholds:\n  static_heavy_bytes: 1\n");
      writeFileSync(join(dir, "confidence.yaml"), 'notes:\n  high: "a"\n  medium: "b"\n  low: "c"\n');
      expect(() => loadRules(dir)).toThrow(/stages.yaml: stage "broken" is missing a "stage" string/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a rule with no when block rather than guessing", () => {
    const dir = mkdtempSync(join(tmpdir(), "shiftpoint-rules-"));
    try {
      writeFileSync(
        join(dir, "stages.yaml"),
        'stages:\n  - id: x\n    confidence: high\n    stage: "a"\n    headroom: "b"\n    tripwire: "c"\n',
      );
      writeFileSync(join(dir, "flags.yaml"), "flags: []\n");
      writeFileSync(join(dir, "profile.yaml"), "thresholds:\n  static_heavy_bytes: 1\n");
      writeFileSync(join(dir, "confidence.yaml"), 'notes:\n  high: "a"\n  medium: "b"\n  low: "c"\n');
      expect(() => loadRules(dir)).toThrow(/missing a "when" block/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildProfile", () => {
  const thresholds = { staticHeavyBytes: 1000 };
  const base: Signal[] = [
    { kind: "jobs", values: ["none"], confidence: "medium", evidence: "" },
    { kind: "asset_bytes", values: [], confidence: "high", metric: 10, evidence: "" },
  ];

  it("reports no demand for a small single service repository", () => {
    expect(buildProfile(base, thresholds).fields["demand"]).toEqual(["none"]);
  });

  it("counts background work as demand", () => {
    const signals: Signal[] = [{ ...base[0]!, values: ["sidekiq"] }, base[1]!];
    expect(buildProfile(signals, thresholds).fields["demand"]).toEqual(["present"]);
  });

  it("counts a second application service as demand", () => {
    const signals: Signal[] = [
      ...base,
      { kind: "app_services", values: [], confidence: "high", metric: 2, evidence: "" },
    ];
    expect(buildProfile(signals, thresholds).fields["demand"]).toEqual(["present"]);
  });

  it("counts heavy assets as demand and applies the threshold from the data", () => {
    const signals: Signal[] = [base[0]!, { ...base[1]!, metric: 1000 }];
    const profile = buildProfile(signals, thresholds);
    expect(profile.fields["assets"]).toEqual(["heavy"]);
    expect(profile.fields["demand"]).toEqual(["present"]);
  });

  it("does not treat a declared replica count as demand", () => {
    // The whole thesis: asking for three replicas is an intention, not a
    // demand signal, so a Kubernetes manifest can never justify itself.
    const signals: Signal[] = [
      ...base,
      { kind: "orchestration", values: ["kubernetes"], confidence: "high", evidence: "replicas: 50" },
    ];
    expect(buildProfile(signals, thresholds).fields["demand"]).toEqual(["none"]);
  });
});
