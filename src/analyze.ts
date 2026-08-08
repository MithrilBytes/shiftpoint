import { runDetectors } from "./detectors/index.js";
import { evaluate } from "./engine/evaluate.js";
import { loadRules } from "./engine/load.js";
import { buildProfile } from "./profile.js";
import { loadRepo } from "./repo.js";
import type { Profile, Verdict } from "./types.js";

export interface Analysis {
  profile: Profile;
  verdict: Verdict;
}

/**
 * Reads a repository from disk and returns its verdict. Every layer runs here
 * in order: detectors, profile, rules. Nothing in this path touches the
 * network.
 */
export function analyze(root: string, rulesDir?: string): Analysis {
  const rules = rulesDir === undefined ? loadRules() : loadRules(rulesDir);
  const repo = loadRepo(root);
  const profile = buildProfile(runDetectors(repo), rules.thresholds);
  return { profile, verdict: evaluate(profile, rules) };
}
