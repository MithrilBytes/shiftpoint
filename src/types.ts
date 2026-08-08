export type Confidence = "high" | "medium" | "low";

/**
 * What a detector emits. A detector never guesses: when it finds nothing it
 * says so with `values: ["none"]` and lowers its confidence accordingly.
 *
 * `metric` carries a raw measurement (bytes, counts) for detectors that
 * measure rather than classify. Thresholds are applied in the profile layer,
 * because thresholds are numbers and numbers live in rules/.
 */
export interface Signal {
  kind: string;
  values: string[];
  confidence: Confidence;
  evidence: string;
  metric?: number;
}

/**
 * Signals aggregated into the shape rules match against. `fields` holds the
 * matchable values, including ones derived here rather than detected
 * (`assets`, `demand`).
 */
export interface Profile {
  fields: Record<string, string[]>;
  confidence: Record<string, Confidence>;
  evidence: Record<string, string>;
}

/** The one object every renderer reads. Nothing renderer specific goes here. */
export interface Verdict {
  stage: string;
  headroom: string;
  tripwire: string;
  flags: string[];
  confidence: Confidence;
  confidenceNote: string;
  doNothingToday: boolean;
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** The weakest link. A verdict is never more confident than its evidence. */
export function lowestConfidence(levels: Confidence[]): Confidence {
  let worst: Confidence = "high";
  for (const level of levels) {
    if (RANK[level] < RANK[worst]) worst = level;
  }
  return worst;
}
