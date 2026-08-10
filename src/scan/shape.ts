import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { detectFramework } from "./framework.js";
import { detectJobs } from "./jobs.js";
import { declaredDependencies, manifestFiles, nodeManifests, pythonManifestFiles } from "./manifest.js";

const NOTEBOOK = /\.ipynb$/;
const MARKDOWN = /\.mdx?$/;
// Only languages a managed or free function tier will actually run. A
// repository of shell scripts and Swift files is tooling, and telling its
// owner about Lambda pricing would be noise.
const SCRIPT_SOURCE = /\.(py|js|mjs|cjs|ts|rb|go)$/;

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
  return undefined;
}
