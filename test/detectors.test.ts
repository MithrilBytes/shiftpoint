import { describe, expect, it } from "vitest";
import { detectAssets } from "../src/detectors/assets.js";
import { detectCi } from "../src/detectors/ci.js";
import { detectContainer } from "../src/detectors/container.js";
import { detectDatabase } from "../src/detectors/database.js";
import { detectFramework } from "../src/detectors/framework.js";
import { runDetectors } from "../src/detectors/index.js";
import { detectJobs } from "../src/detectors/jobs.js";
import { detectOrchestration } from "../src/detectors/orchestration.js";
import { values, withRepo } from "./helpers.js";

describe("framework", () => {
  it("reads the framework out of package.json", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { next: "^14" } }) }, (repo) => {
      const signals = detectFramework(repo);
      expect(values(signals, "language")).toEqual(["node"]);
      expect(values(signals, "framework")).toEqual(["nextjs"]);
    });
  });

  it("reads Flask out of requirements.txt", () => {
    withRepo({ "requirements.txt": "Flask==3.0.3\ngunicorn==22.0.0\n" }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["flask"]);
    });
  });

  it("reads Rails out of a Gemfile", () => {
    withRepo({ Gemfile: 'source "https://rubygems.org"\ngem "rails", "~> 7.1"\n' }, (repo) => {
      const signals = detectFramework(repo);
      expect(values(signals, "language")).toEqual(["ruby"]);
      expect(values(signals, "framework")).toEqual(["rails"]);
    });
  });

  it("calls checked in HTML with no manifest a static site", () => {
    withRepo({ "index.html": "<h1>hello</h1>", "css/site.css": "body{}" }, (repo) => {
      const signals = detectFramework(repo);
      expect(values(signals, "language")).toEqual(["none"]);
      expect(values(signals, "framework")).toEqual(["static"]);
    });
  });

  it("does not call a templated HTML file a static site", () => {
    withRepo({ "requirements.txt": "Flask==3.0.3\n", "templates/index.html": "<h1>{{ x }}</h1>" }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["flask"]);
    });
  });

  it("reports an unrecognized framework as unknown at low confidence", () => {
    withRepo({ "main.c": "int main(void){return 0;}" }, (repo) => {
      const framework = detectFramework(repo).find((signal) => signal.kind === "framework");
      expect(framework?.values).toEqual(["unknown"]);
      expect(framework?.confidence).toBe("low");
    });
  });
});

describe("database", () => {
  it("reads the provider out of a Prisma schema", () => {
    withRepo(
      {
        "package.json": "{}",
        "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}\n',
      },
      (repo) => {
        expect(values(detectDatabase(repo), "database")).toEqual(["postgres"]);
      },
    );
  });

  it("reads the dialect out of a Drizzle config", () => {
    withRepo({ "package.json": "{}", "drizzle.config.ts": 'export default { dialect: "mysql" };' }, (repo) => {
      expect(values(detectDatabase(repo), "database")).toEqual(["mysql"]);
    });
  });

  it("counts an imported sqlite3 module, which never appears in a manifest", () => {
    withRepo({ "requirements.txt": "Flask==3.0.3\n", "app.py": "import sqlite3\n" }, (repo) => {
      expect(values(detectDatabase(repo), "database")).toEqual(["sqlite"]);
    });
  });

  it("reads a database image out of a compose file, but not a cache", () => {
    withRepo(
      {
        "package.json": "{}",
        "docker-compose.yml": "services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n",
      },
      (repo) => {
        expect(values(detectDatabase(repo), "database")).toEqual(["postgres"]);
      },
    );
  });

  it("calls absence medium when there was a manifest to read", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { express: "^4" } }) }, (repo) => {
      const database = detectDatabase(repo)[0];
      expect(database?.values).toEqual(["none"]);
      expect(database?.confidence).toBe("medium");
    });
  });

  it("calls absence low when there was nothing to read", () => {
    withRepo({ "index.html": "<h1>hello</h1>" }, (repo) => {
      const database = detectDatabase(repo)[0];
      expect(database?.values).toEqual(["none"]);
      expect(database?.confidence).toBe("low");
    });
  });
});

describe("container", () => {
  it("finds a Dockerfile and a compose file", () => {
    withRepo({ Dockerfile: "FROM node:20", "docker-compose.yml": "services:\n  web:\n    build: .\n" }, (repo) => {
      expect(values(detectContainer(repo), "container")).toEqual(["dockerfile", "compose"]);
    });
  });

  it("counts application services separately from backing services", () => {
    withRepo(
      {
        "docker-compose.yml":
          "services:\n  web:\n    build: .\n  worker:\n    build: .\n  db:\n    image: postgres:16\n  redis:\n    image: redis:7\n",
      },
      (repo) => {
        const services = detectContainer(repo).find((signal) => signal.kind === "app_services");
        expect(services?.metric).toBe(2);
      },
    );
  });

  it("survives a compose file that is not valid YAML", () => {
    withRepo({ "docker-compose.yml": "services: [unbalanced\n" }, (repo) => {
      expect(values(detectContainer(repo), "container")).toEqual(["compose"]);
    });
  });
});

describe("orchestration", () => {
  it("finds Kubernetes manifests wherever they live", () => {
    withRepo({ "deploy/app.yaml": "apiVersion: apps/v1\nkind: Deployment\n" }, (repo) => {
      expect(values(detectOrchestration(repo), "orchestration")).toEqual(["kubernetes"]);
    });
  });

  it("finds a Helm chart and Terraform", () => {
    withRepo({ "chart/Chart.yaml": "apiVersion: v2\nname: app\n", "infra/main.tf": 'provider "aws" {}' }, (repo) => {
      expect(values(detectOrchestration(repo), "orchestration")).toEqual(["helm", "terraform"]);
    });
  });

  it("does not mistake a compose file or a workflow for a manifest", () => {
    withRepo(
      {
        "docker-compose.yml": "services:\n  web:\n    build: .\n",
        ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
      },
      (repo) => {
        expect(values(detectOrchestration(repo), "orchestration")).toEqual(["none"]);
      },
    );
  });
});

describe("jobs", () => {
  it("finds Sidekiq in a Gemfile", () => {
    withRepo({ Gemfile: 'gem "rails"\ngem "sidekiq", "~> 7.2"\n' }, (repo) => {
      expect(values(detectJobs(repo), "jobs")).toEqual(["sidekiq"]);
    });
  });

  it("finds Celery in a requirements file", () => {
    withRepo({ "requirements.txt": "celery==5.4.0\n" }, (repo) => {
      expect(values(detectJobs(repo), "jobs")).toEqual(["celery"]);
    });
  });

  it("reports no queue library as none", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { express: "^4" } }) }, (repo) => {
      expect(values(detectJobs(repo), "jobs")).toEqual(["none"]);
    });
  });
});

describe("assets", () => {
  it("measures asset bytes and ignores source files", () => {
    withRepo({ "images/logo.svg": "x".repeat(500), "src/app.ts": "y".repeat(9000) }, (repo) => {
      expect(detectAssets(repo)[0]?.metric).toBe(500);
    });
  });
});

describe("every detector", () => {
  it("says what it found it on, including when it found nothing", () => {
    // "A detector never guesses" only means something if a detector can show
    // its work. Every signal carries the evidence behind it, either way.
    withRepo({ "package.json": JSON.stringify({ dependencies: { express: "^4" } }) }, (repo) => {
      const signals = runDetectors(repo);
      expect(signals.length).toBeGreaterThan(0);
      for (const signal of signals) {
        expect(signal.evidence, `${signal.kind} explains itself`).not.toBe("");
      }
    });
    withRepo({ "notes.txt": "nothing to see" }, (repo) => {
      for (const signal of runDetectors(repo)) {
        expect(signal.evidence, `${signal.kind} explains itself`).not.toBe("");
      }
    });
  });
});

describe("ci", () => {
  it("finds a GitHub Actions workflow", () => {
    withRepo({ ".github/workflows/ci.yml": "name: ci\n" }, (repo) => {
      expect(values(detectCi(repo), "ci")).toEqual(["github-actions"]);
    });
  });

  it("reports no CI configuration as none", () => {
    withRepo({ "package.json": "{}" }, (repo) => {
      expect(values(detectCi(repo), "ci")).toEqual(["none"]);
    });
  });
});
