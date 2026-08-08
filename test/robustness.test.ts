import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { renderJson, renderMarkdown, renderTerminal, withRepo } from "./helpers.js";

/**
 * A repository is untrusted input. Every parser here reads files somebody else
 * wrote, and half of them are hand edited formats that are routinely malformed.
 *
 * The rule is that shiftpoint never crashes on a repository. It is allowed to
 * say it could not tell, which is the honest answer to an unreadable manifest,
 * but a stack trace in front of a founder is not an answer at all.
 */

const roots: string[] = [];

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "shiftpoint-rob-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("hostile and malformed repositories", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["an empty directory", {}],
    ["a package.json that is not JSON", { "package.json": "{ this is not json" }],
    ["a package.json that is not an object", { "package.json": '"just a string"' }],
    ["a package.json whose dependencies is a string", { "package.json": '{"dependencies":"nope"}' }],
    ["a go.mod full of garbage", { "go.mod": "module\ngarbage v v v\nrequire (\n" }],
    ["a Kubernetes manifest with broken indentation", { "k8s.yaml": "apiVersion: v1\nkind: Deployment\n  bad: [indent\n" }],
    ["a compose file that is not YAML", { "docker-compose.yml": "services: [unbalanced\n" }],
    ["a compose file whose services is a list", { "docker-compose.yml": "services:\n  - web\n  - worker\n" }],
    ["a truncated Prisma schema", { "prisma/schema.prisma": "datasource db { provider = " }],
    ["empty manifests of every kind", { "package.json": "", "requirements.txt": "", "go.mod": "", Gemfile: "" }],
    ["a requirements file of only comments", { "requirements.txt": "# nothing\n#\n   \n" }],
    ["a Gemfile with no gems", { Gemfile: "source 'https://rubygems.org'\n" }],
    ["a drizzle config with no dialect", { "package.json": "{}", "drizzle.config.ts": "export default {};" }],
    ["a .env with no DATABASE_URL", { "package.json": "{}", ".env.example": "PORT=3000\n" }],
    ["CRLF line endings throughout", { "requirements.txt": "Flask==3.0.3\r\ngunicorn==22.0.0\r\n" }],
    ["a unicode path", { "src/éà中文.py": "print(1)\n" }],
  ];

  for (const [name, files] of cases) {
    it(`answers rather than throwing for ${name}`, () => {
      const root = repoWith(files);
      const { verdict } = analyze(root);
      expect(verdict.stage.length).toBeGreaterThan(0);
      expect(verdict.confidenceNote).toContain("Confidence:");
      // Every renderer has to survive the same input.
      expect(() => renderTerminal(verdict)).not.toThrow();
      expect(() => renderMarkdown(verdict)).not.toThrow();
      expect(() => renderJson(verdict)).not.toThrow();
    });
  }

  it("answers for a file that is not text at all", () => {
    const root = repoWith({});
    writeFileSync(join(root, "package.json"), Buffer.from([0, 1, 2, 3, 255, 254, 0, 200]));
    expect(() => analyze(root)).not.toThrow();
  });

  it("does not follow a symlink loop", () => {
    const root = repoWith({ "package.json": '{"dependencies":{"next":"^14"}}' });
    symlinkSync(root, join(root, "self"));
    const { verdict } = analyze(root);
    expect(verdict.stage.length).toBeGreaterThan(0);
  });

  it("survives a directory it cannot read", () => {
    const root = repoWith({ "package.json": '{"dependencies":{"next":"^14"}}', "locked/f.txt": "x" });
    const locked = join(root, "locked");
    chmodSync(locked, 0o000);
    try {
      expect(() => analyze(root)).not.toThrow();
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("handles deep nesting without blowing the stack", () => {
    const root = repoWith({});
    let deep = root;
    for (let i = 0; i < 80; i += 1) deep = join(deep, `n${i}`);
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "a.py"), "print(1)\n");
    expect(() => analyze(root)).not.toThrow();
  });
});

describe("the same repository always gets the same answer", () => {
  it("is deterministic across runs", () => {
    withRepo(
      {
        "package.json": JSON.stringify({ dependencies: { next: "^14", stripe: "^15", pg: "^8" } }),
        "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}\n',
        "kubernetes/deploy.yaml": "apiVersion: apps/v1\nkind: Deployment\n",
        "chart/Chart.yaml": "apiVersion: v2\nname: app\n",
      },
      (_repo, root) => {
        const first = renderJson(analyze(root).verdict);
        for (let i = 0; i < 5; i += 1) {
          expect(renderJson(analyze(root).verdict)).toBe(first);
        }
      },
    );
  });
});
