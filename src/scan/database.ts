import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import {
  composeServices,
  goDependencies,
  manifestFiles,
  nodeDependencies,
  otherLanguageSources,
  pythonDependencies,
  rubyDependencies,
} from "./manifest.js";

const PRISMA_SCHEMA = /(^|\/)schema\.prisma$/;
const DRIZZLE_CONFIG = /(^|\/)drizzle\.config\.[cm]?[jt]s$/;
const ENV_EXAMPLE = /(^|\/)\.env(\.example|\.sample|\.template)?$/;
const PYTHON_SOURCE = /\.py$/;
const ELIXIR_SOURCE = /\.exs?$/;
const SPRING_CONFIG = /(^|\/)application(-[^/]+)?\.(properties|ya?ml)$/;

// Laravel names its connection in .env and nowhere a dependency list can show
// it: the driver is a PHP extension, not a composer package.
const LARAVEL_CONNECTION = /^\s*DB_CONNECTION\s*=\s*["']?([a-z0-9]+)/im;

// Spring names its database in the JDBC URL, whichever of the two config
// formats the project uses.
const JDBC_URL = /jdbc:([a-z0-9]+):/gi;

// Ecto names its adapter in the repo module, the same way Django names its
// engine in settings. Neither is a dependency, and neither is guessable.
const ECTO_ADAPTER = /Ecto\.Adapters\.(Postgres|MyXQL|SQLite3|Tds)/g;

// Django declares its database in settings, not in a dependency. Nothing else
// in the repository names it: sqlite3 is in the standard library and the ORM
// imports it internally. Without this, a Django app whose entire state is a
// file on local disk was told a function tier would do, which is the one
// deployment that loses the data.
const DJANGO_ENGINE = /django\.db\.backends\.(sqlite3|postgresql[_a-z]*|mysql)/g;

// Maps every name this detector understands onto the engine's vocabulary.
export const ENGINE_BY_ALIAS = new Map<string, string>([
  ["postgresql", "postgres"],
  ["postgres", "postgres"],
  ["pg", "postgres"],
  ["psycopg", "postgres"],
  ["psycopg2", "postgres"],
  ["psycopg2-binary", "postgres"],
  ["asyncpg", "postgres"],
  ["pgx", "postgres"],
  ["pq", "postgres"],
  ["postgres.js", "postgres"],
  ["@supabase/supabase-js", "postgres"],
  ["@neondatabase/serverless", "postgres"],
  ["@vercel/postgres", "postgres"],
  ["mysql", "mysql"],
  ["mysql2", "mysql"],
  ["mysqlclient", "mysql"],
  ["pymysql", "mysql"],
  ["mariadb", "mysql"],
  ["@planetscale/database", "mysql"],
  ["sqlite", "sqlite"],
  ["sqlite3", "sqlite"],
  ["better-sqlite3", "sqlite"],
  ["@libsql/client", "sqlite"],
  ["libsql", "sqlite"],
  ["mongodb", "mongo"],
  ["mongo", "mongo"],
  ["mongoose", "mongo"],
  ["pymongo", "mongo"],
  ["mongoid", "mongo"],
  // Elixir. Ecto talks to a database through one of these drivers, and the
  // driver is named in mix.exs even when the adapter is not.
  ["postgrex", "postgres"],
  ["myxql", "mysql"],
  ["ecto_sqlite3", "sqlite"],
  ["exqlite", "sqlite"],
  // JVM. A pom names the group and the artifact, and either half can be the
  // half that says which database this is.
  ["org.postgresql", "postgres"],
  ["mysql-connector-j", "mysql"],
  ["mysql-connector-java", "mysql"],
  ["mariadb-java-client", "mysql"],
  ["mongodb-driver-sync", "mongo"],
  ["sqlite-jdbc", "sqlite"],
  // PHP. The driver is a PHP extension, and a composer.json that requires one
  // is naming the database.
  ["ext-pdo_pgsql", "postgres"],
  ["ext-pdo_mysql", "mysql"],
  ["ext-pdo_sqlite", "sqlite"],
  ["ext-mongodb", "mongo"],
]);

// Scanning source files is the expensive path, so it is bounded.
const MAX_SOURCE_FILES_SCANNED = 200;

/**
 * Which database the application talks to.
 *
 * When nothing turns up, the confidence of that absence depends on whether
 * there was anything to read. A package.json with no database client is
 * evidence of absence (medium). No manifest at all is absence of evidence
 * (low), and this detector says so rather than guessing.
 */
export function detectDatabase(repo: Repo): Signal[] {
  const found = new Map<string, string>();

  const note = (engine: string | undefined, evidence: string): void => {
    if (engine !== undefined && !found.has(engine)) found.set(engine, evidence);
  };

  for (const file of repo.matching(PRISMA_SCHEMA)) {
    const text = repo.read(file) ?? "";
    for (const match of text.matchAll(/provider\s*=\s*"([^"]+)"/g)) {
      note(ENGINE_BY_ALIAS.get((match[1] ?? "").toLowerCase()), `${file} sets provider ${match[1]}`);
    }
  }

  for (const file of repo.matching(DRIZZLE_CONFIG)) {
    const text = repo.read(file) ?? "";
    const match = /dialect\s*:\s*["']([^"']+)["']/.exec(text);
    if (match) {
      note(ENGINE_BY_ALIAS.get((match[1] ?? "").toLowerCase()), `${file} sets dialect ${match[1]}`);
    }
  }

  for (const name of nodeDependencies(repo)) {
    note(ENGINE_BY_ALIAS.get(name), `package.json depends on ${name}`);
  }
  for (const name of pythonDependencies(repo)) {
    note(ENGINE_BY_ALIAS.get(name), `a python manifest requires ${name}`);
  }
  for (const name of rubyDependencies(repo)) {
    note(ENGINE_BY_ALIAS.get(name), `Gemfile requires ${name}`);
  }
  for (const name of goDependencies(repo)) {
    note(ENGINE_BY_ALIAS.get(name), `go.mod requires ${name}`);
  }
  for (const [names, phrase] of otherLanguageSources(repo)) {
    for (const name of names) {
      note(ENGINE_BY_ALIAS.get(name), `${phrase} ${name}`);
    }
  }

  for (const file of repo.matching(PYTHON_SOURCE).slice(0, MAX_SOURCE_FILES_SCANNED)) {
    const text = repo.read(file) ?? "";
    for (const match of text.matchAll(DJANGO_ENGINE)) {
      const backend = (match[1] ?? "").toLowerCase();
      const engine = backend.startsWith("postgresql") ? "postgres" : backend === "mysql" ? "mysql" : "sqlite";
      note(engine, `${file} sets the Django ${backend} backend`);
    }
  }

  // The Python standard library ships sqlite3, so it never appears in a
  // manifest. Importing it is the only signal there is.
  if (!found.has("sqlite")) {
    for (const file of repo.matching(PYTHON_SOURCE).slice(0, MAX_SOURCE_FILES_SCANNED)) {
      const text = repo.read(file) ?? "";
      if (/\bimport\s+sqlite3\b|\bsqlite3\.connect\b/.test(text)) {
        note("sqlite", `${file} imports sqlite3`);
        break;
      }
    }
  }

  for (const file of repo.matching(ELIXIR_SOURCE).slice(0, MAX_SOURCE_FILES_SCANNED)) {
    const text = repo.read(file) ?? "";
    for (const match of text.matchAll(ECTO_ADAPTER)) {
      const adapter = (match[1] ?? "").toLowerCase();
      // SQL Server has no place on this ladder, so it is read and set aside
      // rather than folded into an engine it is not.
      if (adapter === "tds") continue;
      const engine = adapter === "postgres" ? "postgres" : adapter === "myxql" ? "mysql" : "sqlite";
      note(engine, `${file} sets the Ecto ${match[1]} adapter`);
    }
  }

  for (const file of repo.matching(SPRING_CONFIG)) {
    const text = repo.read(file) ?? "";
    for (const match of text.matchAll(JDBC_URL)) {
      note(ENGINE_BY_ALIAS.get((match[1] ?? "").toLowerCase()), `${file} sets a jdbc:${match[1]} url`);
    }
  }

  const compose = composeServices(repo);
  for (const image of compose?.images ?? []) {
    const name = (image.split("/").pop() ?? "").split(":")[0] ?? "";
    note(ENGINE_BY_ALIAS.get(name.toLowerCase()), `a compose file runs the ${name} image`);
  }

  for (const file of repo.matching(ENV_EXAMPLE)) {
    const text = repo.read(file) ?? "";
    const match = /DATABASE_URL\s*=\s*["']?([a-z0-9+]+):/i.exec(text);
    if (match) {
      note(ENGINE_BY_ALIAS.get((match[1] ?? "").toLowerCase()), `${file} sets a ${match[1]} DATABASE_URL`);
    }
    const connection = LARAVEL_CONNECTION.exec(text);
    if (connection) {
      note(
        ENGINE_BY_ALIAS.get((connection[1] ?? "").toLowerCase()),
        `${file} sets DB_CONNECTION to ${connection[1]}`,
      );
    }
  }

  if (found.size > 0) {
    return [
      {
        kind: "database",
        values: [...found.keys()].sort(),
        confidence: "high",
        evidence: [...found.values()].join("; "),
      },
    ];
  }

  const manifests = manifestFiles(repo);
  if (manifests.length > 0) {
    return [
      {
        kind: "database",
        values: ["none"],
        confidence: "medium",
        evidence: `no database client in ${manifests.join(", ")}`,
      },
    ];
  }

  return [
    {
      kind: "database",
      values: ["none"],
      confidence: "low",
      evidence: "no dependency manifest to read, so absence of a database is unproven",
    },
  ];
}
