import { parse } from "yaml";
import type { Repo } from "../repo.js";

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
const COMPOSE = /(^|\/)(docker-)?compose\.ya?ml$/;

/** Every dependency manifest in the repository, whatever the language. */
export function manifestFiles(repo: Repo): string[] {
  return repo.files.filter(
    (file) =>
      PACKAGE_JSON.test(file) ||
      REQUIREMENTS.test(file) ||
      PYPROJECT.test(file) ||
      GEMFILE.test(file) ||
      GO_MOD.test(file),
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

export function pythonManifestFiles(repo: Repo): string[] {
  return repo.files.filter((file) => REQUIREMENTS.test(file) || PYPROJECT.test(file));
}

export function composeFiles(repo: Repo): string[] {
  return repo.matching(COMPOSE);
}

/** Every package.json that parses, paired with the path it came from. */
export function nodeManifests(repo: Repo): Array<[string, Record<string, unknown>]> {
  const manifests: Array<[string, Record<string, unknown>]> = [];
  for (const file of packageJsonFiles(repo)) {
    const text = repo.read(file);
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
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
  const names = new Set<string>();
  for (const [, record] of nodeManifests(repo)) {
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
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

/** Everything the repository declares it depends on, whatever the language. */
export function declaredDependencies(repo: Repo): Set<string> {
  return new Set([
    ...nodeDependencies(repo),
    ...pythonDependencies(repo),
    ...rubyDependencies(repo),
    ...goDependencies(repo),
  ]);
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
      if (image !== undefined && INFRASTRUCTURE_IMAGE.test(image)) {
        infrastructure.push(name);
      } else {
        app.push(name);
      }
    }
  }

  return parsedAny ? { app, infrastructure, images } : undefined;
}
