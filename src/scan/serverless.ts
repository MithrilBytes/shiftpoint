import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { detectDatabase } from "./database.js";
import { detectFramework } from "./framework.js";
import { detectJobs } from "./jobs.js";
import { declaredDependencies, deployedImages, runtimeDependencies } from "./manifest.js";

// Dependencies that need a process that outlives a request.
//
// The test for membership is one question: does this library exist to hold a
// network connection open for the life of the process? A bot opens one gateway
// connection at startup and holds it until it stops; nothing routes a request
// to it, and there is no version of that which fits in a function invocation.
// The same is true of a websocket transport, a peer to peer node, a watch on
// somebody else's API, and a dashboard server that keeps each open tab's state
// behind a socket.
//
// It is not a list of libraries that are merely slow, large, or asynchronous.
// Those are different findings with different answers, and they have their own
// sets below.
export const PERSISTENT_CONNECTION = new Set([
  // Websocket and long poll transports. The connection is the product.
  "socket.io",
  "ws",
  "uwebsockets.js",
  // gorilla/websocket and nhooyr.io/websocket both normalise to this segment.
  "websocket",
  "websockets",
  "websocket-client",
  "express-ws",
  "@fastify/websocket",
  "channels",
  "django-channels",
  "actioncable",
  "faye",
  "pusher",
  "centrifuge",
  // Chat and protocol gateways. One login at startup, held until the process
  // stops, with the far end pushing whenever it likes.
  "discord.js",
  "discord.py",
  "discordpy",
  "discordrb",
  "nextcord",
  "disnake",
  "py-cord",
  "hikari",
  "telegraf",
  "grammy",
  "python-telegram-bot",
  "pytelegrambotapi",
  "aiogram",
  "telethon",
  "pyrogram",
  "@slack/bolt",
  "@slack/socket-mode",
  "slack-bolt",
  "slack_bolt",
  "irc",
  "cinch",
  "matrix-bot-sdk",
  "matrix-appservice-bridge",
  "matrix-nio",
  "@xmpp/client",
  "slixmpp",
  "sleekxmpp",
  // Peer to peer nodes. A node is only in the network while it is dialled in.
  "libp2p",
  // Watchers on somebody else's API. An operator or a controller holds a watch
  // stream open and reacts to what comes down it, which is a loop that never
  // returns rather than a request that is answered.
  "controller-runtime",
  "kopf",
  // Dashboard servers that keep each session in the process behind a socket.
  // These are not request and response: closing the process drops every open
  // tab, and a second copy of it would not know what the first one was showing.
  "streamlit",
  "gradio",
  "dash",
  "panel",
  "bokeh",
  "voila",
  "nicegui",
  "solara",
]);

/**
 * Dependencies that put the schedule inside the process.
 *
 * A program with its own scheduler has to keep running for its timing to
 * happen: there is no cron entry and nothing external wakes it. That rules out
 * a free function tier for the same reason a held connection does.
 *
 * It says nothing about shape, though, and that is the point of keeping it
 * apart. Nobody connects to a price watcher. It is still a script; it is a
 * script that has to be left running, which is a cheaper answer than a service
 * and an honest one.
 */
export const IN_PROCESS_SCHEDULER = new Set([
  "apscheduler",
  "schedule",
  "rocketry",
  "node-cron",
  "node-schedule",
  "toad-scheduler",
  "croner",
  // The npm package and robfig/cron, which normalises to this segment.
  "cron",
  "gocron",
  "rufus-scheduler",
  "clockwork",
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

// Source files that say how a program starts. Scanning them is the expensive
// path, so it is bounded the same way the database detector bounds its own.
const PROGRAM_SOURCE = /\.(py|[cm]?[jt]sx?|rb|go|rs|java|kt|exs?|php)$/;
const MAX_SOURCE_FILES_SCANNED = 200;

// Tests, in every naming convention that matters. A test opens a socket to
// exercise something else and closes it again, so it describes no deployment of
// its own. This is the reasoning the walker already applies to fixtures and
// examples, applied here to the files those conventions leave in place.
const TEST_SOURCE =
  /(^|\/)(tests?|specs?|__tests__)\/|\.(test|spec)\.[^/]+$|_test\.[^/]+$|_spec\.[^/]+$|(^|\/)test_[^/]+$/;

/**
 * How each ecosystem spells "serve a websocket".
 *
 * A websocket endpoint is a connection this process holds for as long as the
 * client is on the other end of it, which is the same finding a websocket
 * dependency gives, read out of the code instead of the manifest. It is worth
 * reading separately because the transport is often built into the framework:
 * Bun, Deno and Elysia declare a socket route with no dependency to name.
 */
const SERVES_WEBSOCKETS =
  /\bnew\s+websocket(?:server|\.server)\s*\(|\bupgrader\.upgrade\s*\(|\bwebsocket\.accept\s*\(|\.ws\s*\(\s*["'`]\/|@\w+\.websocket\s*\(|\bwebsocket_urlpatterns\b|\bio\.on\s*\(\s*["'`]connection["'`]/;

/**
 * A socket the program listens on and accepts connections from itself.
 *
 * Both halves are required, and together they mean something an HTTP server
 * does not do: this code owns the socket and speaks its own protocol over it.
 * A framework that calls net.Listen and hands the listener to an HTTP server
 * never calls Accept, so it does not match. Nothing that owns a socket can run
 * on a function tier, which delivers a request to a handler and never a
 * connection.
 */
const OPENS_A_LISTENER =
  /\bnet\.listen\s*\(|\btcplistener::bind\s*\(|\btcpserver\.new\s*\(|\bsocket\.socket\s*\(|\bnew\s+serversocket\s*\(/;
const ACCEPTS_CONNECTIONS = /\.accept\s*\(\s*\)|\.incoming\s*\(\s*\)/;

/**
 * A connection this repository's own code holds open, or undefined when there
 * is none. Reported as one sentence naming the file it was read from.
 *
 * Exported because the same fact answers two questions: whether there is
 * something to host here at all, and whether a function tier could host it.
 * Both have to read it the same way, which is why neither reads it alone.
 */
export function heldOpenInSource(repo: Repo): string | undefined {
  const sources = repo.matching(PROGRAM_SOURCE).filter((file) => !TEST_SOURCE.test(file));
  for (const file of sources.slice(0, MAX_SOURCE_FILES_SCANNED)) {
    const raw = repo.read(file);
    if (raw === undefined) continue;
    // Matched against lowercased source. Every ecosystem capitalises these
    // names differently, and the answer does not depend on which one this is.
    const text = raw.toLowerCase();
    if (SERVES_WEBSOCKETS.test(text)) {
      return `${file} serves a websocket, which is a connection held open for as long as the client is there`;
    }
    if (OPENS_A_LISTENER.test(text) && ACCEPTS_CONNECTIONS.test(text)) {
      return `${file} listens on a socket and accepts connections itself, so it speaks its own protocol rather than answering requests`;
    }
  }
  return undefined;
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
]);

/**
 * Dependencies too large or too slow to start inside a free function tier.
 *
 * Heavy, but sized by ordinary things: a headless browser, a video encoder, a
 * numerical library. Any of them runs on a small always on server, so the price
 * is knowable and the ordinary stage rules give it.
 *
 * The classical machine learning libraries belong here rather than above. What
 * a fitted scikit-learn or gradient boosting model loads is a table of
 * coefficients or a few hundred trees: it runs on a CPU, and the smallest
 * servers hold it. They rule out a free function tier on size alone, which is
 * a statement about the machine and not about a model nobody can see, so the
 * ordinary rules can and should put a price on them.
 */
export const HEAVY_RUNTIME = new Set([
  "scikit-learn",
  "sklearn",
  "xgboost",
  "lightgbm",
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
 * Languages the free managed tiers do not run.
 *
 * The free plans this tool prices against, Cloudflare Workers and Vercel's
 * Hobby plan, run JavaScript and Python. None of them takes a PHP application,
 * a JVM service, or a BEAM release, so "a free tier covers this" is not an
 * answer available to these at any traffic level. What they need is a process
 * on a machine of their own, which is the next rung down and a price this tool
 * can give.
 *
 * This is about where the code can run, not about the language.
 */
export const NO_FREE_TIER_RUNTIME = new Set(["php", "java", "elixir", "dotnet", "perl"]);

// Scanning source files is the expensive path, so it is bounded.

const PHP_SOURCE = /\.php$/;
// A PHP page that touches the request is answering one. Nothing else in the
// file says so: there is no main, no listen call, and usually no manifest.
const PHP_REQUEST = /\$_(GET|POST|REQUEST|SERVER|SESSION|COOKIE|FILES)\b|\bheader\s*\(\s*["']/;

const CGI_SOURCE = /\.(cgi|pl)$/;
const CGI_BIN = /(^|\/)cgi-bin\//;
// Server configuration that hands a request to a program instead of returning
// a file. Read only from files that are server configuration, so this stays a
// handful of reads rather than a scan of the repository.
const SERVER_CONFIG = /(^|\/)(\.htaccess|[^/]+\.conf)$/;
const CGI_HANDLER = /ScriptAlias|AddHandler\s+cgi-script|SetHandler\s+cgi-script|Options\s+\+?ExecCGI/;

/**
 * Source a web server executes, rather than a process anybody starts.
 *
 * A PHP page under a document root and a CGI script under a ScriptAlias are
 * both applications with no main function, no port of their own, and often no
 * dependency manifest. The web server receives a request and runs the file.
 * That is how a great deal of the web is still built, and a repository full of
 * those files is plainly something you host even though every signal this tool
 * usually reads is missing.
 *
 * It is read here rather than in the shape detector because it answers two
 * questions at once, the way a held connection does: what this repository is,
 * and why no free function tier will take it. A function tier sells an
 * invocation, not a web server configured to execute your files.
 */
export function serverExecutedSource(repo: Repo): string | undefined {
  for (const file of repo.matching(PHP_SOURCE).slice(0, MAX_SOURCE_FILES_SCANNED)) {
    if (PHP_REQUEST.test(repo.read(file) ?? "")) {
      return `${file} reads the request directly, so a web server runs it per request`;
    }
  }

  const scripts = repo.matching(CGI_SOURCE);
  const underCgiBin = scripts.filter((file) => CGI_BIN.test(file));
  if (underCgiBin[0] !== undefined) {
    return `${underCgiBin[0]} sits under cgi-bin, which a web server executes per request`;
  }

  if (scripts[0] !== undefined) {
    for (const file of repo.matching(SERVER_CONFIG).slice(0, MAX_SOURCE_FILES_SCANNED)) {
      if (CGI_HANDLER.test(repo.read(file) ?? "")) {
        return `${file} configures a web server to execute ${scripts[0]}`;
      }
    }
  }

  return undefined;
}

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

  // The same finding read out of the code. A repository can hold a connection
  // open with nothing in its manifest to say so, because the transport came
  // with the runtime or the socket is opened by hand.
  const inSource = held.length === 0 ? heldOpenInSource(repo) : undefined;
  if (inSource !== undefined) {
    blockers.push(inSource);
    kinds.push("held_connections");
  }

  const scheduled = [...dependencies].filter((name) => IN_PROCESS_SCHEDULER.has(name)).sort();
  if (scheduled.length > 0) {
    blockers.push(
      `${scheduled.join(", ")} keeps the schedule inside the process, so it only runs while the process does`,
    );
    kinds.push("in_process_schedule");
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

  // The runtime itself can be what rules the free tier out. This is read from
  // the manifest, so it is the same class of evidence as the rest.
  const languages = detectFramework(repo).find((signal) => signal.kind === "language")?.values ?? [];
  const unsupported = languages.filter((name) => NO_FREE_TIER_RUNTIME.has(name)).sort();
  if (unsupported.length > 0) {
    blockers.push(`the free managed tiers do not run ${unsupported.join(", ")}`);
    kinds.push("no_free_tier_runtime");
  }

  // Files a web server executes need a web server. A function tier sells an
  // invocation and gives you nowhere to configure one.
  const served = serverExecutedSource(repo);
  if (served !== undefined) {
    blockers.push(`${served}, and a free function tier has no web server to configure`);
    kinds.push("server_executed");
  }

  // A repository that holds no code of its own, and a compose file pinning
  // somebody else's image, is a deployment. What it deploys is a container that
  // stays up, which is not a thing a function tier sells.
  const deployed = deployedImages(repo);
  if (deployed.length > 0) {
    blockers.push(`a compose file runs ${deployed.join(", ")} from a prebuilt image`);
    kinds.push("prebuilt_image");
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
