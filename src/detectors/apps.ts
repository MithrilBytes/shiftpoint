import { dirname } from "node:path";
import type { Repo } from "../repo.js";
import type { Signal } from "../types.js";
import { FRAMEWORK_BY_DEPENDENCY } from "./framework.js";
import { gemfiles, nodeManifests, pythonManifestFiles } from "./manifest.js";

/**
 * How many separately deployable applications this repository holds.
 *
 * A verdict describes one system. When a repository holds several applications
 * the single answer is still useful, but it is an answer about the whole, and
 * the owner deserves to be told that rather than left to assume otherwise.
 *
 * An application root is a directory whose own manifest declares a web
 * framework. A directory with a manifest and no framework is a package, not a
 * deployment, so it does not count.
 */
export function detectApps(repo: Repo): Signal[] {
  const roots = new Map<string, string>();

  for (const [file, manifest] of nodeManifests(repo)) {
    const names = new Set<string>();
    for (const key of ["dependencies", "devDependencies"]) {
      const block = manifest[key];
      if (typeof block !== "object" || block === null) continue;
      for (const name of Object.keys(block)) names.add(name.toLowerCase());
    }
    noteRoot(roots, file, names);
  }

  for (const file of [...pythonManifestFiles(repo), ...gemfiles(repo)]) {
    const text = (repo.read(file) ?? "").toLowerCase();
    const names = new Set([...FRAMEWORK_BY_DEPENDENCY.keys()].filter((name) => text.includes(name)));
    noteRoot(roots, file, names);
  }

  const count = roots.size;
  if (count > 1) {
    return [
      {
        kind: "apps",
        values: ["several"],
        confidence: "high",
        metric: count,
        evidence: `${count} application roots: ${[...roots.values()].join(", ")}`,
      },
    ];
  }

  return [
    {
      kind: "apps",
      values: ["one"],
      confidence: count === 1 ? "high" : "low",
      metric: count,
      evidence:
        count === 1
          ? `one application root at ${[...roots.values()][0]}`
          : "no manifest declares a web framework, so there is no application root to count",
    },
  ];
}

function noteRoot(roots: Map<string, string>, file: string, names: Set<string>): void {
  for (const name of names) {
    if (!FRAMEWORK_BY_DEPENDENCY.has(name)) continue;
    const root = dirname(file);
    if (!roots.has(root)) roots.set(root, file);
    return;
  }
}
