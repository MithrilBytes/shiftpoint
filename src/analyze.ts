import { runDetectors } from "./scan/index.js";
import { evaluate } from "./rules/evaluate.js";
import { loadRules } from "./rules/load.js";
import { buildProfile } from "./rules/profile.js";
import { loadRepo } from "./scan/repo.js";
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
