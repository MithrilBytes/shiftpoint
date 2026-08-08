import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Confidence } from "../types.js";

export interface StageRule {
  id: string;
  when: Record<string, string[]>;
  confidence: Confidence;
  stage: string;
  headroom: string;
  tripwire: string;
  scalars: Record<string, string>;
}

export interface FlagRule {
  id: string;
  when: Record<string, string[]>;
  text: string;
  scalars: Record<string, string>;
}

export interface RuleSet {
  stages: StageRule[];
  flags: FlagRule[];
  thresholds: { staticHeavyBytes: number };
  notes: Record<Confidence, string>;
}

const CONFIDENCE_LEVELS: Confidence[] = ["high", "medium", "low"];

/**
 * Finds the rules directory. It sits next to the compiled engine in a published
 * install (dist/rules) and at the repository root during development.
 */
export function resolveRulesDir(): string {
  const candidates = ["../rules/", "../../rules/"].map((relative) =>
    fileURLToPath(new URL(relative, import.meta.url)),
  );
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "stages.yaml"))) return candidate;
  }
  throw new Error(
    `Could not find the rules directory. Looked in: ${candidates.join(", ")}. ` +
      "If you are running from source, build first or pass a rules directory explicitly.",
  );
}

export function loadRules(dir: string = resolveRulesDir()): RuleSet {
  const stagesFile = "stages.yaml";
  const flagsFile = "flags.yaml";
  const profileFile = "profile.yaml";
  const confidenceFile = "confidence.yaml";

  const stagesDoc = readYaml(dir, stagesFile);
  const flagsDoc = readYaml(dir, flagsFile);
  const profileDoc = readYaml(dir, profileFile);
  const confidenceDoc = readYaml(dir, confidenceFile);

  const stages = list(stagesDoc, "stages", stagesFile).map((raw, index) => {
    const where = `${stagesFile}: stage ${index + 1}`;
    const id = requireString(raw, "id", where);
    return {
      id,
      when: readWhen(raw, `${stagesFile}: stage "${id}"`),
      confidence: readConfidence(raw, `${stagesFile}: stage "${id}"`),
      stage: requireString(raw, "stage", `${stagesFile}: stage "${id}"`),
      headroom: requireString(raw, "headroom", `${stagesFile}: stage "${id}"`),
      tripwire: requireString(raw, "tripwire", `${stagesFile}: stage "${id}"`),
      scalars: readScalars(raw),
    };
  });

  if (stages.length === 0) {
    throw new Error(`${stagesFile}: no stages defined.`);
  }

  const flags = list(flagsDoc, "flags", flagsFile).map((raw, index) => {
    const where = `${flagsFile}: flag ${index + 1}`;
    const id = requireString(raw, "id", where);
    return {
      id,
      when: readWhen(raw, `${flagsFile}: flag "${id}"`),
      text: requireString(raw, "text", `${flagsFile}: flag "${id}"`),
      scalars: readScalars(raw),
    };
  });

  const thresholds = record(profileDoc, "thresholds", profileFile);
  const staticHeavyBytes = thresholds["static_heavy_bytes"];
  if (typeof staticHeavyBytes !== "number") {
    throw new Error(`${profileFile}: thresholds.static_heavy_bytes must be a number.`);
  }

  const rawNotes = record(confidenceDoc, "notes", confidenceFile);
  const notes = {} as Record<Confidence, string>;
  for (const level of CONFIDENCE_LEVELS) {
    const note = rawNotes[level];
    if (typeof note !== "string") {
      throw new Error(`${confidenceFile}: notes.${level} must be a string.`);
    }
    notes[level] = note;
  }

  return { stages, flags, thresholds: { staticHeavyBytes }, notes };
}

function readYaml(dir: string, file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(join(dir, file), "utf8");
  } catch {
    throw new Error(`Could not read ${join(dir, file)}.`);
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid YAML: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${file} must contain a YAML mapping.`);
  }
  return parsed as Record<string, unknown>;
}

function list(doc: Record<string, unknown>, key: string, file: string): Record<string, unknown>[] {
  const value = doc[key];
  if (!Array.isArray(value)) {
    throw new Error(`${file}: "${key}" must be a list.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${file}: ${key}[${index}] must be a mapping.`);
    }
    return entry as Record<string, unknown>;
  });
}

function record(doc: Record<string, unknown>, key: string, file: string): Record<string, unknown> {
  const value = doc[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: "${key}" must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function requireString(raw: Record<string, unknown>, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where} is missing a "${key}" string.`);
  }
  return value;
}

function readConfidence(raw: Record<string, unknown>, where: string): Confidence {
  const value = raw["confidence"];
  if (typeof value !== "string" || !CONFIDENCE_LEVELS.includes(value as Confidence)) {
    throw new Error(`${where} needs a "confidence" of high, medium, or low.`);
  }
  return value as Confidence;
}

/** A `when` block: every key must match, any listed value satisfies its key. */
function readWhen(raw: Record<string, unknown>, where: string): Record<string, string[]> {
  const value = raw["when"];
  if (value === undefined || value === null) {
    throw new Error(`${where} is missing a "when" block. Use "when: {}" to match every repository.`);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} has a "when" that is not a mapping.`);
  }

  const when: Record<string, string[]> = {};
  for (const [field, allowed] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(allowed) || allowed.some((entry) => typeof entry !== "string")) {
      throw new Error(`${where}: when.${field} must be a list of strings.`);
    }
    when[field] = allowed as string[];
  }
  return when;
}

/** Every scalar on a rule, available to that rule's prose as {braces}. */
function readScalars(raw: Record<string, unknown>): Record<string, string> {
  const scalars: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      scalars[key] = String(value);
    }
  }
  return scalars;
}
