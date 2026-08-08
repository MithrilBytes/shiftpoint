import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { detectDatabase } from "./database.js";
import { detectJobs } from "./jobs.js";
import { declaredDependencies, runtimeDependencies } from "./manifest.js";

// Dependencies that need a process that outlives a request.
export const PERSISTENT_CONNECTION = new Set([
  "socket.io",
  "ws",
  "uwebsockets.js",
  "channels",
  "django-channels",
  "actioncable",
  "faye",
  "pusher",
  "centrifuge",
]);

// Dependencies too large or too slow to start inside a free function tier.
export const HEAVY_RUNTIME = new Set([
  "torch",
  "pytorch",
  "tensorflow",
  "keras",
  "transformers",
  "jax",
  "opencv-python",
  "scipy",
  "playwright",
  "puppeteer",
  "selenium",
  "ffmpeg",
  "fluent-ffmpeg",
]);

/**
 * Whether this could run on a serverless or managed free tier, and if not, what
 * stops it.
 *
 * The question a founder actually has is "can I put this somewhere free before
 * I start paying for a box". Something blocks that answer only when the code
 * needs a process that stays alive: background work, held open connections,
 * a database file it writes on local disk, or a runtime too heavy to cold
 * start. Absent all four, a free function tier covers it.
 */
export function detectServerless(repo: Repo): Signal[] {
  const blockers: string[] = [];
  const kinds: string[] = [];

  const jobs = detectJobs(repo)[0]?.values ?? ["none"];
  if (!jobs.includes("none")) {
    blockers.push(`background work (${jobs.join(", ")}) needs a process that keeps running`);
    kinds.push("background_work");
  }

  // Judged on production dependencies only. A test runner or a build tool does
  // not run when a request arrives, so it cannot be what stops this fitting.
  const dependencies = runtimeDependencies(repo);

  const held = [...dependencies].filter((name) => PERSISTENT_CONNECTION.has(name)).sort();
  if (held.length > 0) {
    blockers.push(`${held.join(", ")} holds connections open`);
    kinds.push("held_connections");
  }

  const heavy = [...dependencies].filter((name) => HEAVY_RUNTIME.has(name)).sort();
  if (heavy.length > 0) {
    blockers.push(`${heavy.join(", ")} is too large to cold start in a free function tier`);
    kinds.push("heavy_runtime");
  }

  // A file database is written to local disk, which a function does not keep.
  const database = detectDatabase(repo)[0]?.values ?? ["none"];
  if (database.includes("sqlite")) {
    blockers.push("a single file database has to live on a disk that persists");
    kinds.push("local_disk");
  }

  if (blockers.length > 0) {
    const evidence = blockers.join("; ");
    return [
      { kind: "serverless_fit", values: ["blocked"], confidence: "high", evidence },
      // Why it is blocked decides the answer. A queue needs a cheap always on
      // box; a machine learning runtime needs a machine chosen for the model,
      // which is a different question at a different price.
      { kind: "blocked_by", values: kinds, confidence: "high", evidence },
    ];
  }

  const evidence =
    "nothing here needs a process that outlives a request: no background work, no held connections, no local disk state";
  return [
    { kind: "serverless_fit", values: ["fits"], confidence: "medium", evidence },
    { kind: "blocked_by", values: ["none"], confidence: "medium", evidence },
  ];
}
