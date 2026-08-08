import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { runDetectors } from "../src/scan/index.js";
import { loadRepo } from "../src/scan/repo.js";
import { selectFlags, selectStage } from "../src/rules/evaluate.js";
import { loadRules } from "../src/rules/load.js";
import { buildProfile } from "../src/rules/profile.js";
import { REPO_ROOT, RULES_DIR } from "./helpers.js";

/**
 * The corpus measures whether verdicts are RIGHT. The goldens and the stack
 * tests measure whether they have CHANGED, which is a different question and
 * the only one anything here answered before this file existed.
 *
 * Every wrong answer found so far was found by a person looking at output, not
 * by the suite. This is the thing that produces a number instead.
 *
 * Cases are split into tune and holdout by hashing the case id, so nobody
 * chooses which side a case lands on. Tune misses print, because that is what
 * you iterate against. Holdout misses stay quiet unless SHIFTPOINT_SHOW_HOLDOUT
 * is set, so the held out set keeps measuring rather than becoming another
 * thing to fit.
 */

const CASES_DIR = join(REPO_ROOT, "corpus", "cases");
const rules = loadRules(RULES_DIR);
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Case {
  id: string;
  origin: string;
  expect: { stage: string; flags: string[] };
  files: Record<string, string>;
  split: "tune" | "holdout";
}

/** FNV-1a. Deterministic, and not something a contributor picks. */
function holdout(id: string): boolean {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10 < 3;
}

function loadCases(): Case[] {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => {
      const raw = parse(readFileSync(join(CASES_DIR, name), "utf8")) as Omit<Case, "split">;
      return { ...raw, split: holdout(raw.id) ? ("holdout" as const) : ("tune" as const) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function verdictFor(testCase: Case): { stage: string; flags: string[] } {
  const root = mkdtempSync(join(tmpdir(), "shiftpoint-corpus-"));
  roots.push(root);
  for (const [path, content] of Object.entries(testCase.files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const profile = buildProfile(runDetectors(loadRepo(root)), rules.thresholds);
  return {
    stage: selectStage(profile, rules)?.id ?? "none",
    flags: selectFlags(profile, rules).map((rule) => rule.id).sort(),
  };
}

const cases = loadCases();

describe("corpus", () => {
  it("is present and structurally sound", () => {
    expect(cases.length, "no corpus cases found").toBeGreaterThan(0);

    const ids = new Set<string>();
    const stageIds = new Set(rules.stages.map((rule) => rule.id));
    const flagIds = new Set(rules.flags.map((rule) => rule.id));

    for (const testCase of cases) {
      expect(testCase.id, "every case needs an id").toBeTruthy();
      expect(ids.has(testCase.id), `duplicate id ${testCase.id}`).toBe(false);
      ids.add(testCase.id);
      expect(testCase.origin, `${testCase.id} needs an origin`).toBeTruthy();
      expect(stageIds, `${testCase.id} labels an unknown stage`).toContain(testCase.expect.stage);
      for (const flag of testCase.expect.flags) {
        expect(flagIds, `${testCase.id} labels an unknown flag`).toContain(flag);
      }
      expect(Object.keys(testCase.files).length, `${testCase.id} is too big to be a specimen`).toBeLessThanOrEqual(8);
    }
  });

  it("keeps a holdout set worth measuring", () => {
    // Only meaningful once there are enough cases for the hash to spread them.
    // Asserting a 30% split over five cases measures the hash, not the corpus.
    const MEANINGFUL = 20;
    if (cases.length < MEANINGFUL) {
      console.log(`corpus has ${cases.length} cases; split balance is not checked below ${MEANINGFUL}`);
      return;
    }
    const held = cases.filter((testCase) => testCase.split === "holdout");
    expect(held.length / cases.length).toBeGreaterThan(0.15);
    expect(held.length / cases.length).toBeLessThan(0.45);
  });
});

/** Scored per split, reported as one number each, so the gate is legible. */
function score(split: "tune" | "holdout"): { total: number; stage: number; flags: number; misses: string[] } {
  const subset = cases.filter((testCase) => testCase.split === split);
  let stage = 0;
  let flags = 0;
  const misses: string[] = [];

  for (const testCase of subset) {
    const got = verdictFor(testCase);
    if (got.stage === testCase.expect.stage) stage += 1;
    else misses.push(`${testCase.id}: labelled ${testCase.expect.stage}, got ${got.stage}`);

    if (JSON.stringify(got.flags) === JSON.stringify([...testCase.expect.flags].sort())) flags += 1;
    else misses.push(`${testCase.id}: flags labelled [${testCase.expect.flags}], got [${got.flags}]`);
  }

  return { total: subset.length, stage, flags, misses };
}

describe("accuracy", () => {
  const thresholds = existsSync(join(REPO_ROOT, "corpus", "thresholds.yaml"))
    ? (parse(readFileSync(join(REPO_ROOT, "corpus", "thresholds.yaml"), "utf8")) as {
        tune: { stage: number; flags: number };
        holdout: { stage: number; flags: number };
      })
    : { tune: { stage: 0, flags: 0 }, holdout: { stage: 0, flags: 0 } };

  it("meets the bar on the tune split", () => {
    const result = score("tune");
    if (result.total === 0) {
      console.log("tune split is empty");
      return;
    }
    const stageRate = result.stage / result.total;
    const flagRate = result.flags / result.total;
    // Tune misses print, because tune is what you iterate against.
    if (result.misses.length > 0) {
      console.log(`\ntune misses (${result.misses.length}):\n  ${result.misses.join("\n  ")}\n`);
    }
    console.log(`tune: stage ${(stageRate * 100).toFixed(1)}%, flags ${(flagRate * 100).toFixed(1)}%, n=${result.total}`);
    expect(stageRate).toBeGreaterThanOrEqual(thresholds.tune.stage);
    expect(flagRate).toBeGreaterThanOrEqual(thresholds.tune.flags);
  });

  it("meets the bar on the holdout split", () => {
    const result = score("holdout");
    if (result.total === 0) {
      console.log("holdout split is empty");
      return;
    }
    const stageRate = result.stage / result.total;
    const flagRate = result.flags / result.total;
    // Holdout stays quiet on purpose. Printing the misses turns the held out
    // set into another thing to fit, and then it measures nothing.
    if (process.env["SHIFTPOINT_SHOW_HOLDOUT"] === "1" && result.misses.length > 0) {
      console.log(`\nholdout misses (${result.misses.length}):\n  ${result.misses.join("\n  ")}\n`);
    }
    console.log(
      `holdout: stage ${(stageRate * 100).toFixed(1)}%, flags ${(flagRate * 100).toFixed(1)}%, n=${result.total}`,
    );
    expect(stageRate).toBeGreaterThanOrEqual(thresholds.holdout.stage);
    expect(flagRate).toBeGreaterThanOrEqual(thresholds.holdout.flags);
  });
});
