import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { manifestFiles, nodeDependencies, pythonDependencies, rubyDependencies } from "./manifest.js";

// Queue libraries this tool recognizes, mapped onto the engine's vocabulary.
export const QUEUE_BY_DEPENDENCY = new Map<string, string>([
  ["sidekiq", "sidekiq"],
  ["resque", "resque"],
  ["delayed_job", "delayed_job"],
  ["delayed_job_active_record", "delayed_job"],
  ["good_job", "good_job"],
  ["solid_queue", "solid_queue"],
  ["celery", "celery"],
  ["rq", "rq"],
  ["dramatiq", "dramatiq"],
  ["huey", "huey"],
  ["bullmq", "bullmq"],
  ["bull", "bull"],
  ["agenda", "agenda"],
]);

/**
 * Background work. A queue library in a manifest means the application already
 * does work outside the request cycle, which is the clearest demand signal a
 * repository gives off: it needs somewhere for that work to run.
 */
export function detectJobs(repo: Repo): Signal[] {
  const found = new Map<string, string>();

  const note = (name: string, evidence: string): void => {
    const queue = QUEUE_BY_DEPENDENCY.get(name);
    if (queue !== undefined && !found.has(queue)) found.set(queue, evidence);
  };

  for (const name of nodeDependencies(repo)) note(name, `package.json depends on ${name}`);
  for (const name of pythonDependencies(repo)) note(name, `a python manifest requires ${name}`);
  for (const name of rubyDependencies(repo)) note(name, `Gemfile requires ${name}`);

  if (found.size > 0) {
    return [
      {
        kind: "jobs",
        values: [...found.keys()].sort(),
        confidence: "high",
        evidence: [...found.values()].join("; "),
      },
    ];
  }

  const manifests = manifestFiles(repo);
  return [
    {
      kind: "jobs",
      values: ["none"],
      confidence: manifests.length > 0 ? "medium" : "low",
      evidence:
        manifests.length > 0
          ? `no queue library in ${manifests.join(", ")}`
          : "no dependency manifest to read, so absence of background work is unproven",
    },
  ];
}
