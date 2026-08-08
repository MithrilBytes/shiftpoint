import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

/**
 * Offline is the first non negotiable, so it is enforced mechanically rather
 * than by review. The shipped tool makes zero network calls: no telemetry, no
 * update check, no fetching prices from an API.
 */

const NETWORK_APIS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  // Module specifiers, so an HTTP client name is only a finding when it is
  // being imported rather than merely appearing in a sentence.
  /["'](node:)?(http|https|net|tls|dgram|dns|http2)["']/,
  /["'](axios|undici|got|node-fetch|superagent|ky)["']/,
];

const ALLOWED_RUNTIME_DEPENDENCIES = ["yaml"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("offline", () => {
  it("references no network API anywhere in src", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const api of NETWORK_APIS) {
        if (api.test(text)) offenders.push(`${file} matches ${api}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ships prices as data files rather than fetching them", () => {
    const rules = readdirSync(join(REPO_ROOT, "rules")).filter((name) => name.endsWith(".yaml"));
    expect(rules.sort()).toEqual(["confidence.yaml", "flags.yaml", "profile.yaml", "stages.yaml"]);
    for (const file of rules) {
      expect(readFileSync(join(REPO_ROOT, "rules", file), "utf8")).toMatch(/^version: \d+$/m);
    }
  });

  it("keeps runtime dependencies to the ones that earn their place", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(ALLOWED_RUNTIME_DEPENDENCIES);
  });
});
