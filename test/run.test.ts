import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, run, version, type Streams } from "../src/run.js";
import { FIXTURES_DIR, GOLDENS_DIR } from "./helpers.js";

function capture(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const streams: Streams = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  return { code: run(argv, streams), out, err };
}

describe("parseArgs", () => {
  it("defaults to the current directory and human output", () => {
    expect(parseArgs([])).toEqual({ path: ".", json: false, write: false, help: false, version: false });
  });

  it("reads a path and flags in any order", () => {
    expect(parseArgs(["--json", "some/repo", "--write"])).toEqual({
      path: "some/repo",
      json: true,
      write: true,
      help: false,
      version: false,
    });
  });

  it("rejects an unknown option instead of ignoring it", () => {
    expect(() => parseArgs(["--depth=3"])).toThrow(/Unknown option "--depth=3"/);
  });

  it("rejects a second path", () => {
    expect(() => parseArgs(["a", "b"])).toThrow(/Expected one path/);
  });
});

describe("run", () => {
  it("prints a verdict for a repository", () => {
    const result = capture([join(FIXTURES_DIR, "nextjs-crud")]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Stage:    Managed hosting on the cheapest paid plan");
    expect(result.err).toBe("");
  });

  it("prints JSON on request", () => {
    const result = capture([join(FIXTURES_DIR, "static-site"), "--json"]);
    expect(result.code).toBe(0);
    expect((JSON.parse(result.out) as { confidence: string }).confidence).toBe("high");
  });

  it("writes INFRA.md into the analyzed repository", () => {
    const root = mkdtempSync(join(tmpdir(), "shiftpoint-write-"));
    try {
      cpSync(join(FIXTURES_DIR, "k8s-overkill"), root, { recursive: true });
      const result = capture([root, "--write"]);
      expect(result.code).toBe(0);
      expect(result.out).toContain(`Wrote ${join(root, "INFRA.md")}`);
      expect(readFileSync(join(root, "INFRA.md"), "utf8")).toBe(
        readFileSync(join(GOLDENS_DIR, "k8s-overkill.md"), "utf8"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints help and a version without analyzing anything", () => {
    expect(capture(["--help"]).out).toContain("Makes no network calls.");
    expect(capture(["--version"]).out.trim()).toBe(version());
  });

  it("fails with a plain message when the path is not there", () => {
    const result = capture([join(tmpdir(), "shiftpoint-does-not-exist")]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("does not exist.");
    expect(result.out).toBe("");
  });

  it("fails with a plain message for a bad option", () => {
    const result = capture(["--nope"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Run shiftpoint --help.");
  });
});
