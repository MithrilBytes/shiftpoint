import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { detectDatabase } from "./database.js";
import { detectJobs } from "./jobs.js";
import { declaredDependencies, runtimeDependencies } from "./manifest.js";

// Dependencies that need a process that outlives a request.
//
// Chat clients belong here for the same reason a websocket server does. A bot
// opens one gateway connection at startup and holds it for the life of the
// process; nothing routes a request to it, and there is no version of that
// which fits in a function invocation.
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
  "discord.js",
  "discord.py",
  "discordpy",
  "telegraf",
  "grammy",
  "python-telegram-bot",
  "@slack/bolt",
  "slack-bolt",
  "slack_bolt",
  "irc",
  "matrix-bot-sdk",
]);

/**
 * Dependencies that describe a batch program rather than a service.
 *
 * A crawl runs for as long as it takes, which is minutes or hours once a
 * politeness delay is in it. Free function tiers stop well short of that, so
 * this rules out the same tier a held connection does, for the opposite reason:
 * not a process that never ends, but one run that takes too long.
 */
export const LONG_RUNNING_BATCH = new Set(["scrapy", "crawlee", "apify"]);

/**
 * Production dependencies that fall in one of the sets above.
 *
 * Exported because two of these sets answer a shape question as well as a
 * hosting one, and the shape detector has to read them the same way this file
 * does: production dependencies only, so a test runner never decides what a
 * repository is.
 */
export function runtimeMatching(repo: Repo, names: ReadonlySet<string>): string[] {
  return [...runtimeDependencies(repo)].filter((name) => names.has(name)).sort();
}

/**
 * Dependencies whose size is set by a model file rather than by traffic.
 *
 * Kept apart from the merely heavy because the two lead to different answers.
 * A model decides how much memory the process needs and whether it needs a GPU
 * at all, and none of that can be read out of a repository, so the honest reply
 * is to give no price. "Too big for a function" is a different statement, and
 * one small server answers it.
 */
export const MODEL_RUNTIME = new Set([
  "torch",
  "pytorch",
  "tensorflow",
  "keras",
  "transformers",
  "sentence-transformers",
  "diffusers",
  "accelerate",
  "jax",
  "onnxruntime",
  "onnxruntime-gpu",
  "vllm",
  "llama-cpp-python",
  "ctransformers",
  "openai-whisper",
  "whisper",
  "faster-whisper",
  "whisperx",
  "spacy",
  "ultralytics",
  "scikit-learn",
  "sklearn",
  "xgboost",
  "lightgbm",
]);

/**
 * Dependencies too large or too slow to start inside a free function tier.
 *
 * Heavy, but sized by ordinary things: a headless browser, a video encoder, a
 * numerical library. Any of them runs on a small always on server, so the price
 * is knowable and the ordinary stage rules give it.
 */
export const HEAVY_RUNTIME = new Set([
  "opencv-python",
  "opencv-python-headless",
  "scipy",
  "playwright",
  "playwright-core",
  "puppeteer",
  "puppeteer-core",
  "selenium",
  "ffmpeg",
  "ffmpeg-python",
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

  const batch = [...dependencies].filter((name) => LONG_RUNNING_BATCH.has(name)).sort();
  if (batch.length > 0) {
    blockers.push(`${batch.join(", ")} runs for longer than a function tier allows`);
    kinds.push("long_running");
  }

  const models = [...dependencies].filter((name) => MODEL_RUNTIME.has(name)).sort();
  if (models.length > 0) {
    blockers.push(`${models.join(", ")} loads a model, and the model sizes the machine`);
    kinds.push("model_runtime");
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
