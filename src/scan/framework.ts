import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import {
  cargoDependencies,
  cargoFiles,
  composerFiles,
  gemfiles,
  goDependencies,
  goModFiles,
  jvmBuildFiles,
  manifestFiles,
  mixFiles,
  nodeDependencies,
  otherLanguageSources,
  packageJsonFiles,
  pythonDependencies,
  pythonManifestFiles,
  rubyDependencies,
} from "./manifest.js";

const INDEX_HTML = /(^|\/)index\.html$/;

const ASTRO_CONFIG = /(^|\/)astro\.config\.[cm]?[jt]s$/;
const NEXT_CONFIG = /(^|\/)next\.config\.[cm]?[jt]s$/;
// An Astro adapter is what turns the default file build into a running server.
// It has to be installed to be imported, so the dependency list names it, and
// the configuration names it a second time for adapters this tool has not
// heard of.
const ASTRO_ADAPTER = /^@astrojs\/(node|vercel|netlify|cloudflare|deno)$/;
const ASTRO_ADAPTER_KEY = /\badapter\s*:/;
const SERVER_OUTPUT = /output\s*:\s*["'`](server|hybrid)["'`]/;
const STATIC_EXPORT = /output\s*:\s*["'`]export["'`]/;

/**
 * Configuration with the parts somebody switched off removed.
 *
 * A commented out line is a line that does not run, and reading one as live
 * configuration is how a Next app that serves requests gets called a pile of
 * files. Only comments that start a line are removed, so the two slashes in a
 * URL keep the rest of their line.
 */
function live(repo: Repo, file: string): string {
  return (repo.read(file) ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Frameworks whose build output, not their name, decides whether anything runs
 * in production. Each reports why the build writes files, or undefined when it
 * serves requests.
 *
 * Astro and Next sit on opposite defaults, so each is read against its own.
 * Astro builds to files unless a repository adds an adapter, and adding one is
 * a deliberate act that leaves a dependency and a line of configuration
 * behind. Next builds a server unless next.config asks for an export, which is
 * the same deliberate act pointing the other way. Neither default is guessed
 * at: the configuration is read, and what it does not say is as much a finding
 * as what it does.
 */
const BUILDS_TO_FILES: Record<string, (repo: Repo) => string | undefined> = {
  astro: astroBuildsToFiles,
  nextjs: nextBuildsToFiles,
};

function astroBuildsToFiles(repo: Repo): string | undefined {
  const adapter = [...nodeDependencies(repo)].find((name) => ASTRO_ADAPTER.test(name));
  if (adapter !== undefined) return undefined;

  const configs = repo.matching(ASTRO_CONFIG);
  for (const file of configs) {
    const text = live(repo, file);
    if (SERVER_OUTPUT.test(text) || ASTRO_ADAPTER_KEY.test(text)) return undefined;
  }

  return configs.length > 0
    ? `${configs[0]} sets no adapter, so the build writes files`
    : "no astro adapter is installed, so the build writes files";
}

function nextBuildsToFiles(repo: Repo): string | undefined {
  // Every Next configuration in the repository has to export, not just one.
  // A monorepo holding an exported docs site next to a real application still
  // has an application in it, and that is the half with a bill attached.
  const configs = repo.matching(NEXT_CONFIG);
  if (configs.length === 0) return undefined;
  if (!configs.every((file) => STATIC_EXPORT.test(live(repo, file)))) return undefined;
  return `${configs[0]} sets output to export, so the build writes files`;
}

/**
 * Generators that leave no dependency manifest behind. Hugo is one Go binary
 * nobody vendors and Sphinx is usually installed outside the project, so the
 * evidence is the configuration file each one is named after and the tree of
 * documents it builds from. Both halves are required: a configuration file
 * with nothing to build is not a site, and content with no generator is not
 * one either.
 */
const GENERATORS: Array<{ name: string; config: RegExp; says: RegExp; tree: RegExp }> = [
  { name: "hugo", config: /^hugo\.(toml|ya?ml|json)$/, says: /./, tree: /^content\// },
  { name: "hugo", config: /^config\.(toml|ya?ml)$/, says: /baseurl/i, tree: /^content\// },
  { name: "sphinx", config: /^conf\.py$/, says: /sphinx|html_theme|master_doc/, tree: /\.(rst|md)$/ },
];

function staticGenerator(repo: Repo): string | undefined {
  for (const { name, config, says, tree } of GENERATORS) {
    const file = repo.files.find((path) => config.test(path));
    if (file === undefined) continue;
    if (!says.test(repo.read(file) ?? "")) continue;
    const content = repo.matching(tree);
    if (content.length === 0) continue;
    return `${file} is ${name} configuration, with ${content.length} file(s) for it to build`;
  }
  return undefined;
}

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
  // Rust. A crate that puts an HTTP server in the process, which is what
  // separates a service from the far more common Rust repository: a program
  // somebody installs.
  ["actix-web", "actix"],
  ["axum", "axum"],
  ["rocket", "rocket"],
  ["warp", "warp"],
  ["poem", "poem"],
  ["salvo", "salvo"],
  ["tide", "tide"],
  // PHP, keeping the vendor prefix composer.json writes
  ["laravel/framework", "laravel"],
  ["laravel/lumen-framework", "laravel"],
  ["symfony/framework-bundle", "symfony"],
  ["slim/slim", "slim"],
  // Elixir
  ["phoenix", "phoenix"],
  // JVM, matched on the artifact that puts an HTTP server in the process. A
  // starter that only wires up persistence or batch work is not a web
  // application, so spring-boot-starter on its own does not appear here.
  ["spring-boot-starter-web", "spring-boot"],
  ["spring-boot-starter-webflux", "spring-boot"],
  ["ktor-server-core", "ktor"],
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
  // A Cargo.toml states what a project runs on as plainly as a go.mod does.
  // Without it a Rust repository had no language at all, and the tool answered
  // "we could not tell what this repository runs" for a manifest that names the
  // package, its version and every crate it links.
  if (cargoFiles(repo).length > 0) {
    languages.push("rust");
    languageEvidence.push("Cargo.toml");
  }
  // Languages this tool identifies without being able to reason about them. A
  // composer.json is as plain a statement of what a project runs on as a
  // Gemfile is, and refusing to read it made the single most common shape of
  // small web application on the planet invisible.
  if (composerFiles(repo).length > 0) {
    languages.push("php");
    languageEvidence.push("composer.json");
  }
  if (mixFiles(repo).length > 0) {
    languages.push("elixir");
    languageEvidence.push("mix.exs");
  }
  if (jvmBuildFiles(repo).length > 0) {
    languages.push("java");
    languageEvidence.push(jvmBuildFiles(repo)[0] ?? "a JVM build file");
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
    [cargoDependencies(repo), "Cargo.toml depends on"],
    ...otherLanguageSources(repo),
  ];

  for (const [names, phrase] of sources) {
    for (const name of names) {
      const declared = FRAMEWORK_BY_DEPENDENCY.get(name);
      if (declared === undefined) continue;
      // What a repository installed and what it ships are different questions
      // wherever the framework builds to files under one configuration and
      // runs a server under another.
      const files = BUILDS_TO_FILES[declared]?.(repo);
      const framework = files === undefined ? declared : "static";
      if (frameworks.includes(framework)) continue;
      frameworks.push(framework);
      frameworkEvidence.push(files === undefined ? `${phrase} ${name}` : `${phrase} ${name}, and ${files}`);
    }
  }
  frameworks.sort();

  // A generator that leaves no manifest still leaves its own configuration,
  // and that names the repository as surely as a dependency would. It is
  // checked before the HTML fallback below because these generators write
  // their HTML at build time, so there is none checked in to find.
  const generator = frameworks.length === 0 ? staticGenerator(repo) : undefined;
  if (generator !== undefined) {
    frameworks.push("static");
    frameworkEvidence.push(generator);
  }

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
  { pattern: /\.rs$/, value: "rust" },
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
