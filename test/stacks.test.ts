import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { REPO_ROOT, withRepo } from "./helpers.js";

/**
 * Whole stacks, end to end, for shapes that have no fixture of their own.
 *
 * A fixture pins one verdict byte for byte and is expensive to add. These are
 * cheaper: they assert the one thing about a stack that must not regress. Every
 * case here is a stack that was once answered wrongly, so each is a scar.
 */

interface Case {
  name: string;
  files: Record<string, string>;
  expect: (stage: string) => void;
}

const cases: Case[] = [
  {
    // Returned "A free function tier covers this (est. $0/mo)" with Lambda's
    // free tier as headroom, ignoring the Postgres entirely.
    name: "FastAPI with Postgres",
    files: {
      "requirements.txt": "fastapi==0.111.0\nuvicorn==0.30.1\npsycopg[binary]==3.2.1\n",
      "main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    },
    expect: (stage) => {
      expect(stage).toContain("database included");
      expect(stage).not.toContain("free function tier");
    },
  },
  {
    // Same wrong answer. The SQLite was invisible because go.mod was never
    // parsed, and invisible local disk state looks like it fits a function.
    name: "Go with chi and SQLite",
    files: {
      "go.mod": "module example.com/api\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.12\n\tmodernc.org/sqlite v1.30.0\n)\n",
      "main.go": 'package main\n\nimport "github.com/go-chi/chi/v5"\n\nfunc main() { _ = chi.NewRouter() }\n',
    },
    expect: (stage) => {
      expect(stage).toContain("always on server");
      expect(stage).not.toContain("$0/mo");
    },
  },
  {
    name: "an Astro site",
    files: {
      "package.json": JSON.stringify({ dependencies: { astro: "^4.11.0" } }),
      "src/pages/index.astro": "---\nconst t = 1;\n---\n<h1>{t}</h1>\n",
    },
    expect: (stage) => expect(stage).toContain("$0/mo"),
  },
  {
    name: "Django with Postgres",
    files: {
      "requirements.txt": "Django==5.0.7\npsycopg[binary]==3.2.1\ngunicorn==22.0.0\n",
      "wsgi.py": "from django.core.wsgi import get_wsgi_application\n",
    },
    expect: (stage) => expect(stage).toContain("$0/mo"),
  },
  {
    name: "Django with Celery, which needs a live worker",
    files: {
      "requirements.txt": "Django==5.0.7\ncelery==5.4.0\nredis==5.0.7\npsycopg[binary]==3.2.1\n",
      "wsgi.py": "from django.core.wsgi import get_wsgi_application\n",
    },
    expect: (stage) => {
      expect(stage).toContain("background work");
      expect(stage).not.toContain("$0/mo");
    },
  },
  {
    name: "a Rails app with no database at all",
    files: { Gemfile: 'source "https://rubygems.org"\ngem "rails", "~> 7.1"\n' },
    expect: (stage) => expect(stage).toContain("$0/mo"),
  },
  {
    name: "a repository holding only a Dockerfile",
    files: { Dockerfile: "FROM node:20\nCMD [\"node\", \"x.js\"]\n" },
    expect: (stage) => expect(stage).toContain("could not tell"),
  },
];

describe("whole stacks", () => {
  for (const testCase of cases) {
    it(`answers correctly for ${testCase.name}`, () => {
      withRepo(testCase.files, (_repo, root) => {
        testCase.expect(analyze(root).verdict.stage);
      });
    });
  }
});

describe("shiftpoint on itself", () => {
  // A tool that gets its own repository wrong is not trustworthy about anyone
  // else's. This was wrong until fixtures stopped being read as the product.
  it("knows it is a command line tool and not a service", () => {
    const { verdict, profile } = analyze(REPO_ROOT);

    expect(profile.fields["shape"]).toEqual(["cli"]);
    expect(profile.fields["apps"]).toEqual(["one"]);
    expect(profile.fields["blocked_by"]).toEqual(["none"]);
    expect(verdict.stage).toContain("nothing to host here");
    expect(verdict.stage).not.toMatch(/\$/);
    expect(verdict.doNothingToday).toBe(true);
  });

  it("does not inherit a fixture's stack", () => {
    const { profile } = analyze(REPO_ROOT);
    // Fixtures carry sidekiq, torch, and sqlite. None is shiftpoint's.
    expect(profile.fields["jobs"]).toEqual(["none"]);
    expect(profile.fields["database"]).toEqual(["none"]);
    expect(profile.fields["orchestration"]).toEqual(["none"]);
  });
});
