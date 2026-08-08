import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import {
  gemfiles,
  goDependencies,
  goModFiles,
  manifestFiles,
  nodeDependencies,
  packageJsonFiles,
  pythonDependencies,
  pythonManifestFiles,
  rubyDependencies,
} from "./manifest.js";

const INDEX_HTML = /(^|\/)index\.html$/;

/**
 * Dependency name to framework, shared with the detector that counts how many
 * deployable applications a repository holds so both answer "is this a web
 * application" the same way.
 */
export const FRAMEWORK_BY_DEPENDENCY = new Map<string, string>([
  // Node
  ["next", "nextjs"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["koa", "koa"],
  ["hono", "hono"],
  ["@nestjs/core", "nestjs"],
  ["astro", "astro"],
  // Static site generators. They build to files a free host serves, so they
  // answer the static question rather than the server one.
  ["jekyll", "static"],
  ["@11ty/eleventy", "static"],
  ["eleventy", "static"],
  ["gatsby", "static"],
  ["@docusaurus/core", "static"],
  ["vitepress", "static"],
  ["mkdocs", "static"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["@remix-run/node", "remix"],
  // Python
  ["flask", "flask"],
  ["django", "django"],
  ["fastapi", "fastapi"],
  // Ruby
  ["rails", "rails"],
  ["sinatra", "sinatra"],
  // Go, matched on the normalised segments goDependencies produces
  ["chi", "chi"],
  ["gin", "gin"],
  ["echo", "echo"],
  ["fiber", "fiber"],
]);

/**
 * Language and framework. Both come from dependency manifests, which are the
 * only place a project states what it runs on rather than what it happens to
 * contain.
 *
 * Absence is reported at high confidence here because the method is a scan of
 * every filename in the repository: a missing Gemfile really is a missing
 * Gemfile.
 */
export function detectFramework(repo: Repo): Signal[] {
  const languages: string[] = [];
  const languageEvidence: string[] = [];

  if (packageJsonFiles(repo).length > 0) {
    languages.push("node");
    languageEvidence.push("package.json");
  }
  if (pythonManifestFiles(repo).length > 0) {
    languages.push("python");
    languageEvidence.push(pythonManifestFiles(repo)[0] ?? "a python manifest");
  }
  if (gemfiles(repo).length > 0) {
    languages.push("ruby");
    languageEvidence.push("Gemfile");
  }
  if (goModFiles(repo).length > 0) {
    languages.push("go");
    languageEvidence.push("go.mod");
  }

  // A manifest is the strongest evidence, but plenty of real projects are a
  // few source files and a virtual environment that is not checked in. Falling
  // back to file extensions keeps those visible, at lower confidence, because
  // the code is evidence even when the dependency list is missing.
  const language: Signal =
    languages.length > 0
      ? {
          kind: "language",
          values: languages,
          confidence: "high",
          evidence: `found ${languageEvidence.join(", ")}`,
        }
      : languageFromSources(repo);

  const frameworks: string[] = [];
  const frameworkEvidence: string[] = [];

  const sources: Array<[Set<string>, string]> = [
    [nodeDependencies(repo), "package.json depends on"],
    [pythonDependencies(repo), "a python manifest requires"],
    [rubyDependencies(repo), "Gemfile requires"],
    [goDependencies(repo), "go.mod requires"],
  ];

  for (const [names, phrase] of sources) {
    for (const name of names) {
      const framework = FRAMEWORK_BY_DEPENDENCY.get(name);
      if (framework === undefined || frameworks.includes(framework)) continue;
      frameworks.push(framework);
      frameworkEvidence.push(`${phrase} ${name}`);
    }
  }
  frameworks.sort();

  // Checked in HTML with no framework behind it is a static site. That is a
  // positive finding, not a fallback: both halves are evidence.
  //
  // A manifest does not disqualify it. Plenty of static sites carry a
  // package.json holding nothing but a formatter, and requiring zero manifests
  // made the tool abstain on exactly the repositories whose answer is easiest.
  // It does raise the bar to an index.html at the root, so that a stray
  // template deep inside an application cannot claim the whole repository.
  const html = repo.matching(INDEX_HTML);
  const rooted = repo.has("index.html");
  if (frameworks.length === 0 && (manifestFiles(repo).length === 0 ? html.length > 0 : rooted)) {
    frameworks.push("static");
    frameworkEvidence.push(
      manifestFiles(repo).length === 0
        ? `${html[0]} with no dependency manifest`
        : "index.html at the root and no framework in any manifest",
    );
  }

  const framework: Signal =
    frameworks.length > 0
      ? {
          kind: "framework",
          values: frameworks,
          confidence: "high",
          evidence: frameworkEvidence.join("; "),
        }
      : {
          kind: "framework",
          values: ["unknown"],
          confidence: "low",
          evidence: "no framework this tool recognizes appears in any manifest",
        };

  return [language, framework];
}

const SOURCE_LANGUAGES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\.py$/, value: "python" },
  { pattern: /\.[cm]?[jt]sx?$/, value: "node" },
  { pattern: /\.rb$/, value: "ruby" },
  { pattern: /\.go$/, value: "go" },
];

function languageFromSources(repo: Repo): Signal {
  const found: string[] = [];
  const evidence: string[] = [];

  for (const { pattern, value } of SOURCE_LANGUAGES) {
    const files = repo.matching(pattern);
    if (files.length > 0) {
      found.push(value);
      evidence.push(`${files.length} ${value} source file(s), including ${files[0]}`);
    }
  }

  if (found.length === 0) {
    return {
      kind: "language",
      values: ["none"],
      confidence: "high",
      evidence: "no dependency manifest and no source files this tool recognizes",
    };
  }

  return {
    kind: "language",
    values: found,
    confidence: "medium",
    evidence: `no dependency manifest, but ${evidence.join("; ")}`,
  };
}
