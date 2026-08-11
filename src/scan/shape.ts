import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { detectContainer } from "./container.js";
import { detectFramework } from "./framework.js";
import { detectJobs } from "./jobs.js";
import { detectOrchestration } from "./orchestration.js";
import { exposedPort } from "./container.js";
import {
  heldOpenInSource,
  IN_PROCESS_SCHEDULER,
  LONG_RUNNING_BATCH,
  PERSISTENT_CONNECTION,
  runtimeMatching,
  serverExecutedSource,
} from "./serverless.js";
import {
  cargoFiles,
  composeServices,
  declaredDependencies,
  deployedImages,
  goModFiles,
  manifestFiles,
  nodeManifests,
  pythonManifestFiles,
} from "./manifest.js";

const NOTEBOOK = /\.ipynb$/;
// Tabular files a repository publishes as its content. Deliberately not .json
// or .yaml: those are configuration far more often than they are data.
const DATA_FILE = /\.(csv|tsv|psv|parquet|jsonl|ndjson|arrow|feather|xlsx?)$/i;
const MARKDOWN = /\.mdx?$/;
// Only languages a managed or free function tier will actually run. A
// repository of shell scripts and Swift files is tooling, and telling its
// owner about Lambda pricing would be noise.
const SCRIPT_SOURCE = /\.(py|js|mjs|cjs|ts|rb|go)$/;
// Repositories whose deliverable is the packaging rather than an application.
const GO_SOURCE = /\.go$/;
const GO_MAIN_PACKAGE = /^\s*package\s+main\s*$/m;
const TERRAFORM_FILE = /\.tf(\.json)?$/;
const CHART_FILE = /(^|\/)Chart\.ya?ml$/;

// What a Cargo package builds. A [[bin]] section names a binary outright, and
// cargo builds one from src/main.rs or src/bin/*.rs without being asked. A
// [lib] section or src/lib.rs is the other half of the same question.
const RUST_BINARY_TARGET = /^\s*\[\[bin\]\]/m;
const RUST_BINARY_SOURCE = /^src\/(main\.rs|bin\/[^/]+\.rs)$/;
const RUST_LIBRARY_TARGET = /^\s*\[lib\]/m;

// A directory whose name says the files in it are programs meant for a PATH.
const PROGRAM_DIRECTORY = /^(bin|sbin|libexec)\//;
const SHEBANG = /^#!/;
const MAKEFILE = /(^|\/)(GNUmakefile|[Mm]akefile)$/;

// Where a repository states what its build does, whatever runs the build.
const CI_FILE =
  /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml)$|(^|\/)(Jenkinsfile|GNUmakefile|[Mm]akefile)$/;
// A build step that sends the image it just built to a registry.
const PUSHES_AN_IMAGE =
  /docker\/build-push-action|\b(docker|podman|buildah|nerdctl)\s+(image\s+)?push\b|(^|\s)--push(\s|$)|\bskopeo\s+copy\b|\bkaniko\b/;

/**
 * What kind of thing this repository is, which decides whether any hosting
 * advice applies at all.
 *
 * Most tools assume every repository is a service waiting for a server. Plenty
 * of them are notebooks, libraries, command line tools, or a single script.
 * Telling the owner of a Jupyter notebook to rent a server is worse than saying
 * nothing, so this detector exists to let the rules say "there is nothing to
 * host here" instead.
 */
export function detectShape(repo: Repo): Signal[] {
  const detected = detectFramework(repo).find((signal) => signal.kind === "framework");
  const frameworks = detected?.values ?? [];
  const isStatic = frameworks.includes("static");
  const isService = frameworks.some((value) => value !== "static" && value !== "unknown");

  if (isService) {
    return [signal("service", "high", `a web framework (${frameworks.join(", ")}) is in the manifest`)];
  }

  const notebooks = repo.matching(NOTEBOOK);
  const scripts = repo.matching(SCRIPT_SOURCE);

  // Notebooks are checked before packaging: a repository can carry a
  // pyproject.toml and still be an analysis, not something you deploy.
  //
  // Background work outranks them, though. A queue library means something here
  // runs on a schedule somebody depends on, and one scratch notebook next to a
  // Celery worker used to answer "there is nothing to host here" at high
  // confidence, which is the opposite of true.
  const queues = detectJobs(repo)[0]?.values ?? ["none"];
  const hasBackgroundWork = !queues.includes("none");
  if (!hasBackgroundWork && notebooks.length > 0 && notebooks.length >= scripts.length) {
    return [signal("notebook", "high", `${notebooks.length} notebook(s), including ${notebooks[0]}`)];
  }

  // The framework detector already said why this builds to files, whether that
  // was a generator in the manifest, a build configured to export, a
  // generator's own configuration file, or HTML checked in. Repeating its
  // reasoning here got it wrong: it named an index.html that a generated site
  // does not have, and printed "undefined" when there was none to name.
  if (isStatic) {
    return [signal("static", "high", detected?.evidence ?? "this repository builds to files")];
  }

  // Not every application is a process somebody starts. A PHP page and a CGI
  // script are run by a web server when a request arrives, which is why neither
  // declares a framework or opens a port. This is checked before the packaging
  // questions below because those read manifests, and repositories built this
  // way usually have none at all.
  const served = serverExecutedSource(repo);
  if (served !== undefined) {
    return [signal("service", "high", served)];
  }

  const commandLine = commandLineEntry(repo);
  if (commandLine !== undefined) {
    return [signal("cli", "high", commandLine)];
  }

  const published = publishedLibrary(repo);
  if (published !== undefined) {
    return [signal("library", "medium", published)];
  }

  // A platform manifest states what runs as plainly as a framework dependency
  // does. A Procfile's web process is the one the platform routes HTTP traffic
  // to, and every platform that reads a Procfile keeps it running. Repositories
  // whose whole content is the deployment are common, and answering "we could
  // not tell what this runs" about a file that names the process is a failure
  // to read the one thing the author wrote down.
  const declaredWeb = webProcess(repo);
  if (declaredWeb !== undefined) {
    return [signal("service", "high", declaredWeb)];
  }

  // No code of its own, and a compose file pinning somebody else's image: this
  // repository is not the application, it is the deployment of one. The
  // serverless detector already reads the same fact to rule out a function
  // tier, and shape was the half still saying it could not tell.
  const deployed = deployedImages(repo);
  if (deployed.length > 0 && (composeServices(repo)?.hostBound.length ?? 0) === 0) {
    return [
      signal("service", "high", `a compose file runs ${deployed.join(", ")} from a prebuilt image`),
    ];
  }

  // Not every hosted process answers an HTTP request. A dependency that holds
  // a connection open is a process somebody is already paying to keep alive: a
  // chat bot logs in once and stays logged in for as long as it runs. There is
  // no framework in its manifest and no port to serve on, and saying "we could
  // not tell" hid a server that plainly exists.
  //
  // The same fact is read again by the serverless detector, which is what keeps
  // this off a function tier. Calling it a service without that would quote $0
  // for something a function tier cannot host at all.
  const held = runtimeMatching(repo, PERSISTENT_CONNECTION);
  if (held.length > 0) {
    return [
      signal("service", "high", `${held.join(", ")} holds a connection open for the life of the process`),
    ];
  }

  // The same question asked of the code, for the repositories whose manifest
  // does not answer it. A program that serves a websocket, or that opens a
  // socket and accepts connections on it, is being connected to by somebody.
  const inSource = heldOpenInSource(repo);
  if (inSource !== undefined) {
    return [signal("service", "high", inSource)];
  }

  // And of the file that packages it. A port in a Dockerfile is the author
  // saying the process inside listens, which is the plainest statement a
  // repository makes about being hosted. It is read before the batch runtime
  // below on purpose: a repository holding both a crawler and the daemon that
  // supervises it is the daemon, and the exposed port is which of the two is
  // the thing you run.
  const exposed = exposedPort(repo);
  if (exposed !== undefined) {
    return [signal("service", "medium", exposed)];
  }

  // A batch runtime is the opposite: it starts, works, and stops. That is a
  // program you run, not a service you host, whatever else is in the manifest.
  const batch = runtimeMatching(repo, LONG_RUNNING_BATCH);
  if (batch.length > 0) {
    return [
      signal("script", "high", `${batch.join(", ")} runs a batch job rather than serving requests`),
    ];
  }

  // A scheduler in the process is the other kind of program that has to be left
  // running. Nothing connects to it, so it is not a service; it is a script
  // whose timing dies with it. Saying "we could not tell" about a program whose
  // whole design is "start it and walk away" was the wrong answer, and calling
  // it a service would have priced it as one.
  const scheduled = runtimeMatching(repo, IN_PROCESS_SCHEDULER);
  if (scheduled.length > 0) {
    return [
      signal(
        "script",
        "high",
        `${scheduled.join(", ")} keeps the schedule inside the process, so the program runs on rather than being triggered`,
      ),
    ];
  }

  // Languages that declare no entry point in their manifest state it in what
  // they build instead, so this is asked last: after a framework, after a held
  // connection, after a batch runtime. Everything above is a process somebody
  // hosts, and a repository that ships a binary can be either.
  const program = commandLineProgram(repo);
  if (program !== undefined) {
    return [signal("cli", "high", program)];
  }

  // A project that declares dependencies has been set up to run as something,
  // and if none of them is a framework this tool knows, the honest answer is
  // that it could not tell. Calling it a script instead would route it to the
  // free function tier and quote $0, which is confidently wrong in the
  // direction that costs the owner money.
  const declared = declaredDependencies(repo);
  if (declared.size > 0) {
    return [
      signal(
        "unknown",
        "low",
        `${manifestFiles(repo).join(", ")} declares ${declared.size} dependencies, none of them a framework this tool recognizes`,
      ),
    ];
  }

  // No declared dependencies at all, so loose source files really are loose.
  //
  // Unless the data outnumbers them, in which case the data is the deliverable
  // and the code is a helper that keeps it honest. An open dataset with one
  // standard library validator CI runs on every pull request is not a thing
  // anybody hosts, and calling it a script quoted a free function tier for a
  // file that is never called from outside the repository.
  //
  // Strictly outnumbers, on purpose. One fixture next to one script is a script
  // with a fixture, and this should say nothing about it.
  const data = repo.matching(DATA_FILE);
  if (scripts.length > 0 && data.length > scripts.length) {
    return [
      signal(
        "unknown",
        "low",
        `${data.length} data file(s) against ${scripts.length} source file(s), so the deliverable here looks like the data rather than the code`,
      ),
    ];
  }

  if (scripts.length > 0) {
    return [
      signal("script", "medium", `${scripts.length} source file(s), no manifest, and no web framework`),
    ];
  }

  // Documents and nothing else. No manifest, no source, no generator: a
  // repository like this is prose, and prose is read where it sits or served
  // as files. Either way there is no process to pay for, which is the answer a
  // static site already gets.
  //
  // Markdown has to outnumber everything else for this to hold. Almost every
  // repository carries a README, and one of those speaks for its own project,
  // not for the repository around it.
  const markdown = repo.matching(MARKDOWN);
  if (markdown.length > repo.files.length - markdown.length) {
    return [
      signal("static", "medium", `${markdown.length} markdown file(s) and nothing else this tool recognizes`),
    ];
  }

  return [signal("unknown", "low", "no source files this tool recognizes")];
}

function signal(value: string, confidence: Signal["confidence"], evidence: string): Signal {
  return { kind: "shape", values: [value], confidence, evidence };
}

const PROCFILE = /(^|\/)Procfile(\.[^/]+)?$/;
// The one process type every platform that reads a Procfile routes traffic to.
// A worker line is background work, which the jobs detector answers, and a
// release line runs once and exits.
const WEB_PROCESS = /^\s*web\s*:\s*\S/m;

/** A declared web process: something is served, whatever is behind it. */
function webProcess(repo: Repo): string | undefined {
  for (const file of repo.matching(PROCFILE)) {
    if (WEB_PROCESS.test(repo.read(file) ?? "")) {
      return `${file} declares a web process, which is the one a platform routes requests to`;
    }
  }
  return undefined;
}

/** A bin entry or a console script is a thing you install, not a thing you host. */
function commandLineEntry(repo: Repo): string | undefined {
  for (const [file, manifest] of nodeManifests(repo)) {
    if (manifest["bin"] !== undefined) return `${file} declares a bin entry`;
  }
  for (const file of pythonManifestFiles(repo)) {
    const text = repo.read(file) ?? "";
    if (/\[project\.scripts\]|console_scripts/.test(text)) {
      return `${file} declares a console script`;
    }
  }
  return undefined;
}

/**
 * Packaged for other people to import, so it is published rather than deployed.
 *
 * A "main" field on its own means nothing: "npm init -y" writes one into every
 * package.json it creates. Calling that a library told the owner of a long
 * running bot there was nothing to host. Something that is actually published
 * says so in a second way, by declaring its exports, the files it ships, or how
 * it should be published.
 */
const PUBLISHING_INTENT = ["exports", "files", "publishConfig", "types", "typings"];

function publishedLibrary(repo: Repo): string | undefined {
  // A GitHub Action is referenced by other repositories and runs on their
  // runners. It carries a manifest and real dependencies, so it reads like an
  // application, but nothing about it is ever deployed from here. Only the root
  // file counts: an application may keep a composite action under .github/ and
  // that says nothing about the repository as a whole.
  for (const file of ["action.yml", "action.yaml"]) {
    if (!repo.has(file)) continue;
    if (/^runs:/m.test(repo.read(file) ?? "")) {
      return `${file} declares a GitHub Action, which runs on the caller's runner`;
    }
  }

  for (const [file, manifest] of nodeManifests(repo)) {
    if (manifest["private"] === true) continue;
    const declared = PUBLISHING_INTENT.filter((key) => manifest[key] !== undefined);
    if (declared.length > 0) {
      return `${file} declares ${declared.join(" and ")} for importers`;
    }
  }
  for (const file of pythonManifestFiles(repo)) {
    const text = repo.read(file) ?? "";
    if (/^\[project\]/m.test(text) || /setuptools\.setup|^\s*setup\(/m.test(text)) {
      return `${file} packages this for distribution`;
    }
  }

  // Go states this in the code rather than in the manifest: a module with no
  // main package builds no binary, so there is nothing to run and consumers
  // import it. Most Go libraries also declare no dependencies at all, which
  // used to leave them looking like a folder of loose scripts.
  const goModule = goModFiles(repo)[0];
  const goSources = repo.matching(GO_SOURCE);
  if (goModule !== undefined && goSources.length > 0) {
    const main = goSources.find((file) => GO_MAIN_PACKAGE.test(repo.read(file) ?? ""));
    if (main === undefined) {
      return `${goModule} with no main package in ${goSources.length} Go file(s), so this is imported rather than run`;
    }
  }

  // Rust says the same thing in its manifest and its layout. A crate that
  // builds a library and no binary is linked into somebody else's program,
  // which is what a crate published to crates.io or wrapped up by wasm-pack is
  // for. Requiring the absence of a binary is the whole of it: a command line
  // tool commonly keeps its logic in src/lib.rs too, and that alone would have
  // called every one of them a library.
  const cargo = cargoFiles(repo)[0];
  if (cargo !== undefined && !buildsARustBinary(repo, cargo)) {
    if (RUST_LIBRARY_TARGET.test(repo.read(cargo) ?? "") || repo.has("src/lib.rs")) {
      return `${cargo} builds a library and no binary, so this is linked into other programs`;
    }
  }

  // Infrastructure code and no application anywhere near it. A Terraform module
  // and a chart repository are both packages: other repositories reference them
  // by source and install them, and nothing is deployed from here. The
  // discriminator is that there is no application to deploy. The moment a
  // repository holds both the code and the files that deploy it, those files
  // describe that deployment and this does not apply.
  const nothingToDeploy = manifestFiles(repo).length === 0 && repo.matching(SCRIPT_SOURCE).length === 0;
  const packaged = repo.matching(TERRAFORM_FILE).length > 0 || repo.matching(CHART_FILE).length > 0;
  if (packaged && nothingToDeploy) {
    return "infrastructure code with no application source and no dependency manifest, so the module is the deliverable";
  }

  // The same argument for a container image, with one more thing required of
  // it. A Dockerfile on its own proves nothing: most repositories that carry
  // one carry it because that is how their application ships, and a Dockerfile
  // with nothing beside it is an incomplete repository rather than a package.
  // What makes the image the deliverable is a build that pushes it to a
  // registry with no application of its own anywhere near it. Other
  // repositories then write FROM and consume it exactly as they consume a
  // package, which is publication in the sense every other branch here means.
  //
  // Only a Dockerfile at the root counts, for the reason the GitHub Action
  // above is read only at the root: an application may keep one in a
  // subdirectory and that says nothing about the repository as a whole.
  if (repo.has("Dockerfile") && nothingToDeploy) {
    const build = repo.files.find((file) => CI_FILE.test(file) && PUSHES_AN_IMAGE.test(repo.read(file) ?? ""));
    if (build !== undefined) {
      return `${build} pushes the image Dockerfile builds, and there is no application here to deploy`;
    }
  }

  return undefined;
}

function buildsARustBinary(repo: Repo, cargo: string): boolean {
  return RUST_BINARY_TARGET.test(repo.read(cargo) ?? "") || repo.matching(RUST_BINARY_SOURCE).length > 0;
}

/**
 * Libraries whose whole purpose is to turn argv into a program's options.
 *
 * A dependency on one of these is a repository saying, in its manifest, that a
 * person types this name and some words after it. No service needs one to be
 * reached.
 */
const ARGUMENT_PARSER = new Set([
  // Rust
  "clap",
  "structopt",
  "argh",
  "gumdrop",
  "pico-args",
  "lexopt",
  "bpaf",
  // Go, matched on the normalised segments goDependencies produces
  "cobra",
  "urfave",
  "kingpin",
  "pflag",
  "go-flags",
  // Python
  "click",
  "typer",
  "docopt",
  // Node
  "commander",
  "yargs",
  "cac",
  "meow",
  "@oclif/core",
  // Ruby
  "thor",
  "gli",
]);

/** The same thing said with the standard library instead of a dependency. */
const STANDARD_ARGUMENT_PARSING =
  /\bflag\.(Parse|Args?|String|Int|Int64|Bool|Float64|Duration|Var)\(|\benv::args\b|\bArgumentParser\(|\bgetopts?\b/;

/**
 * A call that opens a listening socket.
 *
 * A process that waits for connections is hosted, not installed, whatever it
 * read off its own command line on the way up. A metrics exporter takes
 * --listen from argv and is still a process somebody keeps running, and without
 * this every daemon that accepts a flag would read as a tool you download.
 */
const LISTENS_FOR_CONNECTIONS =
  /\bListenAndServe(TLS)?\(|\bnet\.Listen\(|\bTcpListener::bind\(|\bHttpServer::new\(|\bserve_forever\(|\.listen\(/;

interface Program {
  /** The sources that are the program's own entry point. */
  files: string[];
  evidence: string;
}

/**
 * A program somebody installs and runs from a shell.
 *
 * Two independent things have to be true, because either alone is worthless.
 * The repository has to ship something executable, and that executable has to
 * be driven from a command line. Every web service compiles to a binary too, so
 * "this builds a binary" identifies nothing on its own; and a repository full
 * of argument parsing with nothing to install is a library of helpers.
 *
 * Said that way it holds across languages that declare it very differently: a
 * Cargo binary target with clap, a Go main package that calls flag.Parse, a
 * directory of shell programs a Makefile copies onto a PATH. Node and Python
 * are already answered earlier and more directly, by the bin field and the
 * console script entry point their manifests carry.
 */
function commandLineProgram(repo: Repo): string | undefined {
  const program = executableProgram(repo);
  if (program === undefined) return undefined;
  if (program.files.some((file) => LISTENS_FOR_CONNECTIONS.test(repo.read(file) ?? ""))) return undefined;
  if (shipsAsARunningProcess(repo)) return undefined;

  const driven = commandLineInterface(repo, program.files);
  return driven === undefined ? undefined : `${program.evidence}, and ${driven}`;
}

/**
 * The repository also says how to keep this thing running somewhere.
 *
 * Nobody writes a Deployment for a program people install on their laptops.
 * A binary that arrives with an image to run it, a compose file, or a chart is
 * a process its owner runs, however many flags it accepts on the way up: a
 * queue consumer takes --brokers and is still a daemon.
 *
 * Falling silent here costs a command line tool that happens to publish an
 * image nothing but the answer it already got, "we could not tell". Getting it
 * wrong the other way tells the owner of a running process there is nothing to
 * host, which is the expensive direction.
 */
function shipsAsARunningProcess(repo: Repo): boolean {
  const container = detectContainer(repo).find((found) => found.kind === "container")?.values ?? ["none"];
  const orchestration = detectOrchestration(repo)[0]?.values ?? ["none"];
  return !container.includes("none") || !orchestration.includes("none");
}

/** What this repository builds or ships that a person could execute. */
function executableProgram(repo: Repo): Program | undefined {
  const cargo = cargoFiles(repo)[0];
  if (cargo !== undefined && buildsARustBinary(repo, cargo)) {
    const sources = repo.matching(RUST_BINARY_SOURCE);
    return {
      files: sources,
      evidence: RUST_BINARY_TARGET.test(repo.read(cargo) ?? "")
        ? `${cargo} declares a binary target`
        : `${cargo} and ${sources[0]}, which cargo builds as a binary`,
    };
  }

  const goModule = goModFiles(repo)[0];
  if (goModule !== undefined) {
    const mains = repo.matching(GO_SOURCE).filter((file) => GO_MAIN_PACKAGE.test(repo.read(file) ?? ""));
    if (mains.length > 0) {
      return { files: mains, evidence: `${goModule} with a main package in ${mains[0]}, which builds a binary` };
    }
  }

  // Nothing compiles here: the file that is checked in is the program. A
  // shebang says it runs on its own, and the directory says it is meant for
  // somebody's PATH rather than being a helper the build calls.
  const shipped = repo.matching(PROGRAM_DIRECTORY).filter((file) => SHEBANG.test(repo.read(file) ?? ""));
  if (shipped.length > 0) {
    return { files: shipped, evidence: `${shipped.length} executable program(s) checked in, including ${shipped[0]}` };
  }

  return undefined;
}

/** Evidence that the program above is driven by what a person types after it. */
function commandLineInterface(repo: Repo, sources: string[]): string | undefined {
  const parsers = [...declaredDependencies(repo)].filter((name) => ARGUMENT_PARSER.has(name)).sort();
  if (parsers.length > 0) return `${parsers.join(", ")} parses its command line`;

  const parses = sources.find((file) => STANDARD_ARGUMENT_PARSING.test(repo.read(file) ?? ""));
  if (parses !== undefined) return `${parses} reads its own arguments`;

  return installsOntoPath(repo);
}

/**
 * An install target that writes into a directory called bin.
 *
 * That is the plainest statement a repository can make that what it produces
 * belongs on somebody's PATH. It is deliberately not "has an install target":
 * half the projects on earth have one that installs their dependencies, and
 * where it writes is what separates the two.
 */
function installsOntoPath(repo: Repo): string | undefined {
  for (const file of repo.matching(MAKEFILE)) {
    const recipe = /^install:.*\n((?:[ \t]+\S.*\n?)*)/m.exec(repo.read(file) ?? "")?.[1];
    if (recipe !== undefined && /\bbin\b/.test(recipe)) {
      return `${file} installs into a bin directory, so this belongs on a PATH`;
    }
  }
  return undefined;
}
