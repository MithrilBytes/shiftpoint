import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { detectFramework } from "./framework.js";
import { detectJobs } from "./jobs.js";
import { LONG_RUNNING_BATCH, PERSISTENT_CONNECTION, runtimeMatching } from "./serverless.js";
import {
  declaredDependencies,
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

  const commandLine = commandLineEntry(repo);
  if (commandLine !== undefined) {
    return [signal("cli", "high", commandLine)];
  }

  const published = publishedLibrary(repo);
  if (published !== undefined) {
    return [signal("library", "medium", published)];
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

  // A batch runtime is the opposite: it starts, works, and stops. That is a
  // program you run, not a service you host, whatever else is in the manifest.
  const batch = runtimeMatching(repo, LONG_RUNNING_BATCH);
  if (batch.length > 0) {
    return [
      signal("script", "high", `${batch.join(", ")} runs a batch job rather than serving requests`),
    ];
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

  // Infrastructure code and no application anywhere near it. A Terraform module
  // and a chart repository are both packages: other repositories reference them
  // by source and install them, and nothing is deployed from here. The
  // discriminator is that there is no application to deploy. The moment a
  // repository holds both the code and the files that deploy it, those files
  // describe that deployment and this does not apply.
  const packaged = repo.matching(TERRAFORM_FILE).length > 0 || repo.matching(CHART_FILE).length > 0;
  if (packaged && manifestFiles(repo).length === 0 && repo.matching(SCRIPT_SOURCE).length === 0) {
    return "infrastructure code with no application source and no dependency manifest, so the module is the deliverable";
  }

  return undefined;
}
