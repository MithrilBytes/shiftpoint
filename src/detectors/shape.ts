import type { Repo } from "../repo.js";
import type { Signal } from "../types.js";
import { detectFramework } from "./framework.js";
import { declaredDependencies, manifestFiles, nodeManifests, pythonManifestFiles } from "./manifest.js";

const NOTEBOOK = /\.ipynb$/;
const INDEX_HTML = /(^|\/)index\.html$/;
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
  const frameworks = detectFramework(repo).find((signal) => signal.kind === "framework")?.values ?? [];
  const isStatic = frameworks.includes("static");
  const isService = frameworks.some((value) => value !== "static" && value !== "unknown");

  if (isService) {
    return [signal("service", "high", `a web framework (${frameworks.join(", ")}) is in the manifest`)];
  }

  const notebooks = repo.matching(NOTEBOOK);
  const scripts = repo.matching(SCRIPT_SOURCE);

  // Notebooks are checked before packaging: a repository can carry a
  // pyproject.toml and still be an analysis, not something you deploy.
  if (notebooks.length > 0 && notebooks.length >= scripts.length) {
    return [signal("notebook", "high", `${notebooks.length} notebook(s), including ${notebooks[0]}`)];
  }

  if (isStatic) {
    return [signal("static", "high", `${repo.matching(INDEX_HTML)[0]} with no dependency manifest`)];
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

/** Packaged for other people to import, so it is published rather than deployed. */
function publishedLibrary(repo: Repo): string | undefined {
  for (const [file, manifest] of nodeManifests(repo)) {
    if (manifest["private"] === true) continue;
    if (manifest["main"] !== undefined || manifest["exports"] !== undefined) {
      return `${file} declares an entry point for importers`;
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
