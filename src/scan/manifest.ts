import { parse } from "yaml";
import type { Repo } from "./repo.js";

/**
 * Shared readers for the dependency manifests several detectors need. Kept in
 * one place so "what does this repository depend on" is answered the same way
 * whether the question came from the framework, database, or jobs detector.
 */

const PACKAGE_JSON = /(^|\/)package\.json$/;
const REQUIREMENTS = /(^|\/)requirements[^/]*\.txt$/;
const PYPROJECT = /(^|\/)(pyproject\.toml|Pipfile|setup\.py)$/;
const GEMFILE = /(^|\/)Gemfile$/;
const GO_MOD = /(^|\/)go\.mod$/;
const CARGO_TOML = /(^|\/)Cargo\.toml$/;
const COMPOSE = /(^|\/)(docker-)?compose\.ya?ml$/;

// Manifests this tool reads to identify a project rather than to reason about
// it. It runs none of these languages and resolves none of their dependency
// trees. It reads the one line each file uses to name the framework and the
// database driver, which is the same thing it reads a Gemfile for.
const COMPOSER_JSON = /(^|\/)composer\.json$/;
const MIX_EXS = /(^|\/)mix\.exs$/;
const JVM_BUILD = /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/;
// A .NET project file and a deno.json say the same thing in their own dialect.
// The csproj names the SDK it builds against and the packages it references;
// deno.json names what the code imports and where each import resolves to.
// Refusing to open either left two mainstream runtimes invisible, which reads
// to their owners as "this tool has never heard of my stack".
const DOTNET_PROJECT = /(^|\/)[^/]+\.(csproj|fsproj|vbproj)$/;
const DENO_MANIFEST = /(^|\/)deno\.jsonc?$/;

/** Every dependency manifest in the repository, whatever the language. */
export function manifestFiles(repo: Repo): string[] {
  return repo.files.filter(
    (file) =>
      PACKAGE_JSON.test(file) ||
      REQUIREMENTS.test(file) ||
      PYPROJECT.test(file) ||
      GEMFILE.test(file) ||
      GO_MOD.test(file) ||
      CARGO_TOML.test(file) ||
      COMPOSER_JSON.test(file) ||
      MIX_EXS.test(file) ||
      JVM_BUILD.test(file) ||
      DOTNET_PROJECT.test(file) ||
      DENO_MANIFEST.test(file),
  );
}

export function packageJsonFiles(repo: Repo): string[] {
  return repo.matching(PACKAGE_JSON);
}

export function gemfiles(repo: Repo): string[] {
  return repo.matching(GEMFILE);
}

export function goModFiles(repo: Repo): string[] {
  return repo.matching(GO_MOD);
}

export function cargoFiles(repo: Repo): string[] {
  return repo.matching(CARGO_TOML);
}

export function pythonManifestFiles(repo: Repo): string[] {
  return repo.files.filter((file) => REQUIREMENTS.test(file) || PYPROJECT.test(file));
}

export function composeFiles(repo: Repo): string[] {
  return repo.matching(COMPOSE);
}

export function composerFiles(repo: Repo): string[] {
  return repo.matching(COMPOSER_JSON);
}

export function mixFiles(repo: Repo): string[] {
  return repo.matching(MIX_EXS);
}

export function jvmBuildFiles(repo: Repo): string[] {
  return repo.matching(JVM_BUILD);
}

export function dotnetProjectFiles(repo: Repo): string[] {
  return repo.matching(DOTNET_PROJECT);
}

export function denoManifestFiles(repo: Repo): string[] {
  return repo.matching(DENO_MANIFEST);
}

/**
 * Package names from every composer.json. Names keep their vendor prefix,
 * because that is how PHP names a package and how the manifest spells it:
 * laravel/framework, not framework.
 */
export function composerDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of composerFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    for (const key of ["require", "require-dev"]) {
      const block = (parsed as Record<string, unknown>)[key];
      if (typeof block !== "object" || block === null) continue;
      for (const name of Object.keys(block)) names.add(name.toLowerCase());
    }
  }
  return names;
}

/** Application names from every mix.exs: {:phoenix, "~> 1.7"} yields phoenix. */
export function mixDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of mixFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    for (const match of text.matchAll(/\{\s*:([a-z][a-z0-9_]*)\s*,/g)) {
      names.add(match[1] ?? "");
    }
  }
  return names;
}

/**
 * Coordinates from every Maven pom and Gradle build file. Group and artifact
 * are both kept, because either half can be the recognisable one:
 * org.postgresql is the group, spring-boot-starter-web is the artifact.
 *
 * This is not dependency resolution. Nothing here follows a parent pom, reads a
 * version catalogue, or expands a starter into what it pulls in.
 */
export function jvmDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of jvmBuildFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    for (const match of text.matchAll(/<(?:groupId|artifactId)>\s*([^<\s]+)\s*<\//g)) {
      names.add((match[1] ?? "").toLowerCase());
    }
    // Gradle writes a coordinate as one quoted string, group:artifact:version.
    for (const match of text.matchAll(/["']([\w.-]+:[\w.-]+(?::[^"']*)?)["']/g)) {
      for (const part of (match[1] ?? "").toLowerCase().split(":")) {
        if (part !== "") names.add(part);
      }
    }
  }
  return names;
}

/**
 * Package references and the SDK from every .NET project file.
 *
 * The SDK is kept alongside the packages because it is where a .NET project
 * says what kind of thing it is. Microsoft.NET.Sdk.Web builds an application
 * that listens; the plain Microsoft.NET.Sdk builds a console program. No
 * package reference states that, so reading only the references would leave
 * every ASP.NET service looking like a library of C# files.
 */
export function dotnetDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of dotnetProjectFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    for (const match of text.matchAll(
      /<(?:PackageReference|FrameworkReference)\s[^>]*Include\s*=\s*["']([^"']+)["']/g,
    )) {
      names.add((match[1] ?? "").toLowerCase());
    }
    for (const match of text.matchAll(/<Project\s[^>]*Sdk\s*=\s*["']([^"']+)["']/g)) {
      names.add((match[1] ?? "").toLowerCase());
    }
  }
  return names;
}

/**
 * Names from every deno.json import map.
 *
 * Deno states a dependency as a specifier rather than a package name, so both
 * halves are read: the alias on the left, which is what the code writes, and
 * the URL or npm/jsr specifier on the right, which is what it resolves to.
 * Every segment of each is kept, the same way go.mod paths are broken up, so a
 * name is found wherever the specifier happens to carry it. That over collects
 * hosts and path parts, which is harmless: none of them collide with the names
 * a detector looks for.
 */
export function denoDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of denoManifestFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      // deno.jsonc is allowed comments, and JSON.parse is not.
      parsed = JSON.parse(
        text.replace(/^﻿/, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, ""),
      );
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const imports = (parsed as Record<string, unknown>)["imports"];
    if (typeof imports !== "object" || imports === null) continue;
    for (const [alias, target] of Object.entries(imports as Record<string, unknown>)) {
      for (const name of specifierNames(alias)) names.add(name);
      if (typeof target === "string") {
        for (const name of specifierNames(target)) names.add(name);
      }
    }
  }
  return names;
}

// Scheme and registry words carry no package name of their own. Written as a
// pattern rather than a list of quoted strings so this file states no protocol
// name: the offline check greps src/ for exactly that, and it is right to.
const SPECIFIER_NOISE = /^(ht{2}ps?|npm|jsr|node|file|x|std)$/;

function specifierNames(specifier: string): string[] {
  const names: string[] = [];
  for (const part of specifier.split(/[/:]/)) {
    const name = (part.replace(/^[$@]/, "").split("@")[0] ?? "").toLowerCase();
    if (name === "" || SPECIFIER_NOISE.test(name)) continue;
    // A version, not a name.
    if (/^v?\d/.test(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * The manifests of the languages this tool identifies but does not reason
 * about, each paired with how to say where a name came from.
 *
 * Kept together so the framework and database detectors read them the same way,
 * and so the list of languages in this position is one line to extend.
 */
export function otherLanguageSources(repo: Repo): Array<[Set<string>, string]> {
  return [
    [composerDependencies(repo), "composer.json requires"],
    [mixDependencies(repo), "mix.exs requires"],
    [jvmDependencies(repo), `${jvmBuildFiles(repo)[0] ?? "a JVM build file"} declares`],
    [dotnetDependencies(repo), `${dotnetProjectFiles(repo)[0] ?? "a .NET project file"} references`],
    [denoDependencies(repo), `${denoManifestFiles(repo)[0] ?? "deno.json"} imports`],
  ];
}

/** Every package.json that parses, paired with the path it came from. */
export function nodeManifests(repo: Repo): Array<[string, Record<string, unknown>]> {
  const manifests: Array<[string, Record<string, unknown>]> = [];
  for (const file of packageJsonFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      // A byte order mark is legal in a UTF-8 file and illegal in JSON, and
      // editors on Windows still write them. Dropping it is the difference
      // between reading a manifest and not seeing the project at all.
      parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    manifests.push([file, parsed as Record<string, unknown>]);
  }
  return manifests;
}

/** Dependency names from every package.json, runtime and development alike. */
export function nodeDependencies(repo: Repo): Set<string> {
  return nodeDependencyNames(repo, ["dependencies", "devDependencies", "peerDependencies"]);
}

/**
 * Only what the application needs in production.
 *
 * The distinction matters wherever a dependency implies something about how the
 * code runs. Playwright in devDependencies is a test runner; the same name in
 * dependencies would be a browser the service drives at request time. Treating
 * them alike told an ordinary Express app it was sized by a machine learning
 * model.
 */
export function runtimeDependencies(repo: Repo): Set<string> {
  const names = nodeDependencyNames(repo, ["dependencies"]);
  // Python, Ruby, and Go manifests do not separate the two in a form this tool
  // reads, so their names are runtime names as far as it can tell.
  for (const name of pythonDependencies(repo)) names.add(name);
  for (const name of rubyDependencies(repo)) names.add(name);
  for (const name of goDependencies(repo)) names.add(name);
  // Cargo does draw the distinction, in a table of its own, so it is honoured.
  for (const name of cargoDependencies(repo, false)) names.add(name);
  return names;
}

function nodeDependencyNames(repo: Repo, keys: string[]): Set<string> {
  const names = new Set<string>();
  for (const [, record] of nodeManifests(repo)) {
    for (const key of keys) {
      const block = record[key];
      if (typeof block !== "object" || block === null) continue;
      for (const name of Object.keys(block)) names.add(name.toLowerCase());
    }
  }
  return names;
}

/**
 * Distribution names from requirements files and pyproject style manifests.
 * pyproject parsing pulls every quoted token and keeps the leading name, which
 * over collects harmlessly: the extra tokens do not collide with the names any
 * detector looks for.
 */
export function pythonDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of pythonManifestFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;

    if (REQUIREMENTS.test(file)) {
      for (const line of text.split("\n")) {
        const name = requirementName(line);
        if (name) names.add(name);
      }
      continue;
    }

    for (const match of text.matchAll(/["']([^"'\n]+)["']/g)) {
      const name = requirementName(match[1] ?? "");
      if (name) names.add(name);
    }
  }
  return names;
}

function requirementName(line: string): string | undefined {
  const withoutComment = line.split("#")[0]?.trim() ?? "";
  if (withoutComment === "" || withoutComment.startsWith("-")) return undefined;
  const name = withoutComment.split(/[\s=<>!~;[\](),]/)[0]?.trim().toLowerCase();
  return name === "" ? undefined : name;
}

/**
 * Module names from every go.mod, normalised so a full import path can be
 * matched against the same short names the other languages use.
 * "github.com/go-chi/chi/v5" yields chi, "modernc.org/sqlite" yields sqlite,
 * and "github.com/mattn/go-sqlite3" yields sqlite3.
 */
export function goDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();

  for (const file of goModFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;

    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("//")[0]?.trim() ?? "";
      const match = /^(?:require\s+)?([^\s()]+\/[^\s()]+)\s+v\d/.exec(line);
      const path = match?.[1];
      if (path === undefined) continue;

      names.add(path.toLowerCase());
      for (const segment of path.toLowerCase().split("/")) {
        // Version suffixes carry no meaning, and Go projects conventionally
        // prefix or suffix a package name with the language.
        if (/^v\d+$/.test(segment)) continue;
        names.add(segment);
        names.add(segment.replace(/^go-/, "").replace(/-go$/, ""));
      }
    }
  }

  return names;
}

/** The Cargo tables that name a crate this package depends on. */
const CARGO_DEPENDENCY_TABLE = new Set(["dependencies", "dev-dependencies", "build-dependencies"]);

/**
 * Crate names from every Cargo.toml.
 *
 * Cargo separates what a program links at run time from what only its tests and
 * its build script need, the same distinction package.json draws between
 * dependencies and devDependencies, so this can honour it.
 *
 * Both spellings of a dependency table are read: the `[dependencies]` block
 * with one crate per line, and the `[dependencies.serde]` block a crate gets
 * when its options do not fit on one. Platform blocks such as
 * `[target.'cfg(unix)'.dependencies]` end in the same table name and are read
 * with the rest. This is not TOML parsing; it is the one line each entry uses
 * to name a crate.
 */
export function cargoDependencies(repo: Repo, includeDevelopment = true): Set<string> {
  const names = new Set<string>();
  const wanted = (table: string): boolean =>
    table === "dependencies" || (includeDevelopment && CARGO_DEPENDENCY_TABLE.has(table));

  for (const file of cargoFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;

    let inside = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0]?.trim() ?? "";
      const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
      if (header !== null) {
        const parts = (header[1] ?? "").split(".");
        const last = parts[parts.length - 1] ?? "";
        const parent = parts[parts.length - 2] ?? "";
        inside = CARGO_DEPENDENCY_TABLE.has(last) && wanted(last);
        // [dependencies.clap] names the crate in the header itself.
        if (!inside && CARGO_DEPENDENCY_TABLE.has(parent) && wanted(parent)) names.add(last.toLowerCase());
        continue;
      }
      if (!inside) continue;
      const name = /^([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
      if (name !== undefined) names.add(name.toLowerCase());
    }
  }

  return names;
}

/** Everything the repository declares it depends on, whatever the language. */
export function declaredDependencies(repo: Repo): Set<string> {
  const names = new Set([
    ...nodeDependencies(repo),
    ...pythonDependencies(repo),
    ...rubyDependencies(repo),
    ...goDependencies(repo),
    ...cargoDependencies(repo),
  ]);
  for (const [other] of otherLanguageSources(repo)) {
    for (const name of other) names.add(name);
  }
  return names;
}

/** Gem names from every Gemfile. */
export function rubyDependencies(repo: Repo): Set<string> {
  const names = new Set<string>();
  for (const file of gemfiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    for (const match of text.matchAll(/gem\s+["']([^"']+)["']/g)) {
      names.add((match[1] ?? "").toLowerCase());
    }
  }
  return names;
}

/** Images that are infrastructure a service depends on, not the app itself. */
const INFRASTRUCTURE_IMAGE =
  /^(docker\.io\/)?(library\/)?(postgres|postgis|mysql|mariadb|mongo|redis|valkey|memcached|rabbitmq|nats|elasticsearch|opensearch|clickhouse|minio|localstack|mailhog|mailpit|adminer|traefik|nginx)\b/i;

export interface ComposeServices {
  app: string[];
  infrastructure: string[];
  images: string[];
  /** Application services that pull a prebuilt image instead of building one. */
  deployed: string[];
  /**
   * Services wired to the machine they run on.
   *
   * A device node, the host's network namespace, or a privileged container are
   * each a statement that this deployment is that box and nowhere else. No
   * managed platform hands out /dev/dri or port 53 on the house LAN, so a
   * repository holding one of these is a machine's configuration rather than an
   * application somebody could host. Reading it as a deployment quotes a server
   * price for a home NAS that already has one.
   */
  hostBound: string[];
}

/**
 * Services declared across every compose file, split into the application's
 * own services and the backing services it runs alongside. A service that
 * builds from source is the application; a service that pulls a known
 * datastore or proxy image is not.
 */
export function composeServices(repo: Repo): ComposeServices | undefined {
  const files = composeFiles(repo);
  if (files.length === 0) return undefined;

  const app: string[] = [];
  const infrastructure: string[] = [];
  const images: string[] = [];
  const deployed: string[] = [];
  const hostBound: string[] = [];
  let parsedAny = false;

  for (const file of files) {
    const text = repo.read(file);
    if (text === undefined) continue;
    let document: unknown;
    try {
      document = parse(text);
    } catch {
      continue;
    }
    if (typeof document !== "object" || document === null) continue;
    const services = (document as Record<string, unknown>)["services"];
    if (typeof services !== "object" || services === null) continue;
    parsedAny = true;

    for (const [name, raw] of Object.entries(services as Record<string, unknown>)) {
      const service = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const image = typeof service["image"] === "string" ? service["image"] : undefined;
      if (image !== undefined) images.push(image);
      if (
        service["devices"] !== undefined ||
        service["privileged"] === true ||
        service["network_mode"] === "host"
      ) {
        hostBound.push(name);
      }
      if (image !== undefined && INFRASTRUCTURE_IMAGE.test(image)) {
        infrastructure.push(name);
      } else {
        app.push(name);
        // Built from source here, or pulled ready made. The difference says
        // whether the application lives in this repository or somewhere else.
        if (image !== undefined) deployed.push(name);
      }
    }
  }

  return parsedAny ? { app, infrastructure, images, deployed, hostBound } : undefined;
}

/**
 * Application services running a prebuilt image, in a repository that holds no
 * dependency manifest of its own.
 *
 * A repository like that is not the application: it is the deployment of one.
 * Small team and homelab self hosting looks exactly like this, a compose file
 * pinning somebody else's image with the database it needs beside it. Requiring
 * the absence of a manifest is what keeps this from firing on an ordinary
 * project whose compose file happens to pin a tool alongside its own code.
 */
export function deployedImages(repo: Repo): string[] {
  if (manifestFiles(repo).length > 0) return [];
  return composeServices(repo)?.deployed ?? [];
}
