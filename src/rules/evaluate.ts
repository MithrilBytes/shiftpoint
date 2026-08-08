import type { Confidence, Profile, Verdict } from "../types.js";
import { lowestConfidence } from "../types.js";
import type { RuleSet } from "./load.js";

/**
 * Maps a profile onto a verdict. This function holds no numbers and no prose:
 * both come from rules/, so changing a price or a sentence never means changing
 * code.
 */
export function evaluate(profile: Profile, rules: RuleSet): Verdict {
  const stage = rules.stages.find((rule) => matches(rule.when, profile.fields));
  if (stage === undefined) {
    throw new Error(
      "rules/stages.yaml: nothing matched. The last stage needs \"when: {}\" so every repository gets an answer.",
    );
  }

  const flags = rules.flags
    .filter((rule) => matches(rule.when, profile.fields))
    .map((rule) => fill(rule.text, rule.scalars, `rules/flags.yaml: flag "${rule.id}"`));

  // A verdict is only as strong as the weakest signal it leaned on.
  const matched: Confidence[] = Object.keys(stage.when).map(
    (field) => profile.confidence[field] ?? "low",
  );
  const confidence = lowestConfidence([stage.confidence, ...matched]);

  // Caveats say the answer fits less well, which is a different thing from the
  // evidence being thin, so they ride alongside the confidence rather than
  // lowering it.
  const caveats = rules.caveats
    .filter((rule) => matches(rule.when, profile.fields))
    .map((rule) => rule.text);

  const where = `rules/stages.yaml: stage "${stage.id}"`;
  return {
    stage: fill(stage.stage, stage.scalars, where),
    headroom: fill(stage.headroom, stage.scalars, where),
    tripwire: fill(stage.tripwire, stage.scalars, where),
    flags,
    confidence,
    confidenceNote: [rules.notes[confidence], ...caveats].join(" "),
    // Flags are things to remove. With none of them, there is nothing to do.
    doNothingToday: flags.length === 0,
  };
}

/** Every key in `when` must be satisfied; any one listed value satisfies a key. */
export function matches(when: Record<string, string[]>, fields: Record<string, string[]>): boolean {
  return Object.entries(when).every(([field, allowed]) =>
    (fields[field] ?? []).some((value) => allowed.includes(value)),
  );
}

/** Substitutes {placeholders} from the scalars on the same rule. */
export function fill(text: string, scalars: Record<string, string>, where: string): string {
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = scalars[key];
    if (value === undefined) {
      throw new Error(`${where} uses {${key}} but defines no ${key}.`);
    }
    return value;
  });
}
