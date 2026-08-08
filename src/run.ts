import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyze } from "./analyze.js";
import { renderJson } from "./render/json.js";
import { renderMarkdown } from "./render/markdown.js";
import { renderTerminal } from "./render/terminal.js";

export interface Options {
  path: string;
  json: boolean;
  write: boolean;
  help: boolean;
  version: boolean;
}

export const HELP = `shiftpoint: what infrastructure this repository actually needs.

Usage:
  shiftpoint [path]

Options:
  --json      Print the verdict as JSON.
  --write     Write INFRA.md into the analyzed repository.
  --version   Print the version.
  --help      Print this message.

Reads only the files in the repository. Makes no network calls.
`;

export function parseArgs(argv: string[]): Options {
  const options: Options = { path: ".", json: false, write: false, help: false, version: false };
  let pathSeen = false;

  for (const arg of argv) {
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--write":
        options.write = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option "${arg}". Run shiftpoint --help.`);
        }
        if (pathSeen) {
          throw new Error(`Expected one path, got a second one: "${arg}".`);
        }
        options.path = arg;
        pathSeen = true;
    }
  }

  return options;
}

export function version(): string {
  const text = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(text) as { version: string }).version;
}

export interface Streams {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Returns the process exit code. Every write goes through `streams`. */
export function run(argv: string[], streams: Streams): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    streams.err((error as Error).message + "\n");
    return 1;
  }

  if (options.help) {
    streams.out(HELP);
    return 0;
  }
  if (options.version) {
    streams.out(version() + "\n");
    return 0;
  }

  const root = resolve(options.path);
  try {
    if (!statSync(root).isDirectory()) {
      streams.err(`${root} is not a directory.\n`);
      return 1;
    }
  } catch {
    streams.err(`${root} does not exist.\n`);
    return 1;
  }

  let verdict;
  try {
    verdict = analyze(root).verdict;
  } catch (error) {
    streams.err((error as Error).message + "\n");
    return 1;
  }

  if (options.write) {
    const target = join(root, "INFRA.md");
    writeFileSync(target, renderMarkdown(verdict));
    streams.out(`Wrote ${target}\n\n`);
  }

  streams.out(options.json ? renderJson(verdict) : renderTerminal(verdict));
  return 0;
}
