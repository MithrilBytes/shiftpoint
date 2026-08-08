import type { Confidence, Profile, Signal } from "../types.js";

export interface Thresholds {
  staticHeavyBytes: number;
}

/**
 * Turns raw signals into the shape rules match against.
 *
 * Two fields are derived here rather than detected:
 *
 * `assets` applies the byte threshold from rules/profile.yaml, which is passed
 * in so this stays a pure function and detectors stay free of numbers.
 *
 * `demand` answers the question the whole tool turns on: does this repository
 * show signs of needing more than one small machine? Demand comes only from
 * what the application does. What the deployment configuration asks for is
 * never demand, because a replica count is an intention and this tool reads
 * evidence.
 */
export function buildProfile(signals: Signal[], thresholds: Thresholds): Profile {
  const fields: Record<string, string[]> = {};
  const confidence: Record<string, Confidence> = {};
  const evidence: Record<string, string> = {};

  for (const signal of signals) {
    if (signal.values.length === 0) continue;
    fields[signal.kind] = signal.values;
    confidence[signal.kind] = signal.confidence;
    evidence[signal.kind] = signal.evidence;
  }

  const assetBytes = signals.find((signal) => signal.kind === "asset_bytes")?.metric ?? 0;
  const heavy = assetBytes >= thresholds.staticHeavyBytes;
  fields["assets"] = [heavy ? "heavy" : "light"];
  confidence["assets"] = "high";
  evidence["assets"] = `${assetBytes} bytes of checked in assets`;

  const appServices = signals.find((signal) => signal.kind === "app_services")?.metric ?? 0;
  const jobs = fields["jobs"] ?? ["none"];

  const reasons: string[] = [];
  if (!jobs.includes("none")) reasons.push(`background work (${jobs.join(", ")})`);
  if (appServices > 1) reasons.push(`${appServices} application services`);
  if (heavy) reasons.push("heavy static assets");

  fields["demand"] = [reasons.length > 0 ? "present" : "none"];
  confidence["demand"] = "high";
  evidence["demand"] =
    reasons.length > 0
      ? `demand from ${reasons.join(", ")}`
      : "no background work, no second application service, no heavy assets";

  return { fields, confidence, evidence };
}
