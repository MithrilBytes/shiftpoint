import type { Repo } from "../repo.js";
import type { Signal } from "../types.js";
import { detectAssets } from "./assets.js";
import { detectCi } from "./ci.js";
import { detectContainer } from "./container.js";
import { detectDatabase } from "./database.js";
import { detectFramework } from "./framework.js";
import { detectJobs } from "./jobs.js";
import { detectOrchestration } from "./orchestration.js";

export type Detector = (repo: Repo) => Signal[];

export const DETECTORS: Detector[] = [
  detectFramework,
  detectDatabase,
  detectContainer,
  detectOrchestration,
  detectJobs,
  detectAssets,
  detectCi,
];

export function runDetectors(repo: Repo): Signal[] {
  return DETECTORS.flatMap((detect) => detect(repo));
}

export { detectAssets, detectCi, detectContainer, detectDatabase, detectFramework, detectJobs, detectOrchestration };
