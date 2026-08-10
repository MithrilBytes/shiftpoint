import { describe, expect, it } from "vitest";
import { detectAssets } from "../src/scan/assets.js";
import { detectCi } from "../src/scan/ci.js";
import { detectContainer } from "../src/scan/container.js";
import { detectDatabase } from "../src/scan/database.js";
import { detectFramework } from "../src/scan/framework.js";
import { runDetectors } from "../src/scan/index.js";
import { detectJobs } from "../src/scan/jobs.js";
import { detectOrchestration } from "../src/scan/orchestration.js";
import { detectApps } from "../src/scan/apps.js";
import { detectCommercial } from "../src/scan/commercial.js";
import { detectServerless } from "../src/scan/serverless.js";
import { detectShape } from "../src/scan/shape.js";
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

  it("sees a language from source files when no manifest is checked in", () => {
    // A virtual environment is not committed, so a real Python project can be
    // one file and a .gitignore. Falling back to extensions keeps it visible.
    withRepo({ "src/render.py": "print('hi')\n" }, (repo) => {
      const language = detectFramework(repo).find((signal) => signal.kind === "language");
      expect(language?.values).toEqual(["python"]);
      expect(language?.confidence).toBe("medium");
    });
  });

  it("reads dependencies out of go.mod, including the database driver", () => {
    withRepo(
      {
        "go.mod": "module example.com/api\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.12\n\tmodernc.org/sqlite v1.30.0\n)\n",
        "main.go": "package main\n",
      },
      (repo) => {
        expect(values(detectFramework(repo), "language")).toEqual(["go"]);
        expect(values(detectFramework(repo), "framework")).toEqual(["chi"]);
        expect(values(detectDatabase(repo), "database")).toEqual(["sqlite"]);
      },
    );
  });

  it("recognizes the frameworks that used to fall through to a script", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ "requirements.txt": "fastapi==0.111.0\n" }, "fastapi"],
      // With an adapter, because Astro without one builds to files and is
      // reported as static. Both directions are covered below.
      [{ "package.json": JSON.stringify({ dependencies: { astro: "^4", "@astrojs/node": "^8" } }) }, "astro"],
      [{ "package.json": JSON.stringify({ dependencies: { "@sveltejs/kit": "^2" } }) }, "sveltekit"],
      [{ Gemfile: 'gem "sinatra"\n' }, "sinatra"],
    ];
    for (const [files, expected] of cases) {
      withRepo(files, (repo) => {
        expect(values(detectFramework(repo), "framework"), expected).toEqual([expected]);
      });
    }
  });

  it("reads Astro's build output rather than its name", () => {
    // Astro's default build writes files. An adapter is the deliberate act
    // that puts a server behind it, and it cannot be used without being
    // installed, so the dependency list is where that shows up.
    const config = 'import { defineConfig } from "astro/config";\nexport default defineConfig({});\n';
    withRepo({ "package.json": JSON.stringify({ dependencies: { astro: "^4" } }), "astro.config.mjs": config }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["static"]);
    });
    withRepo(
      { "package.json": JSON.stringify({ dependencies: { astro: "^4", "@astrojs/node": "^8" } }), "astro.config.mjs": config },
      (repo) => {
        expect(values(detectFramework(repo), "framework")).toEqual(["astro"]);
      },
    );
    withRepo(
      {
        "package.json": JSON.stringify({ dependencies: { astro: "^4" } }),
        "astro.config.mjs": 'export default { output: "server" };\n',
      },
      (repo) => {
        expect(values(detectFramework(repo), "framework")).toEqual(["astro"]);
      },
    );
  });

  it("reads Next's build output rather than its name", () => {
    // Next runs a server unless next.config exports to files, which is the
    // same deliberate act as Astro's adapter pointing the other way.
    withRepo(
      {
        "package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "next.config.js": 'module.exports = { output: "export" };\n',
      },
      (repo) => {
        expect(values(detectFramework(repo), "framework")).toEqual(["static"]);
      },
    );
    withRepo(
      {
        "package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "next.config.js": "module.exports = { reactStrictMode: true };\n",
      },
      (repo) => {
        expect(values(detectFramework(repo), "framework")).toEqual(["nextjs"]);
      },
    );
    // A line somebody switched off is not configuration.
    withRepo(
      {
        "package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "next.config.js": '// output: "export"\nmodule.exports = {};\n',
      },
      (repo) => {
        expect(values(detectFramework(repo), "framework")).toEqual(["nextjs"]);
      },
    );
    // One exported docs site does not make the application beside it static.
    withRepo(
      {
        "apps/docs/package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "apps/docs/next.config.js": 'module.exports = { output: "export" };\n',
        "apps/web/package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "apps/web/next.config.js": "module.exports = {};\n",
      },
      (repo) => {
        expect(values(detectFramework(repo), "framework")).toEqual(["nextjs"]);
      },
    );
  });

  it("recognizes a generator that leaves no dependency manifest", () => {
    // Hugo is one binary nobody vendors and Sphinx is installed outside the
    // project, so neither leaves a manifest. Both leave the configuration file
    // they are named after and the tree of documents they build from.
    withRepo({ "hugo.toml": 'baseURL = "https://x.example/"\n', "content/_index.md": "# x\n" }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["static"]);
    });
    withRepo({ "conf.py": 'html_theme = "furo"\n', "index.rst": "Title\n=====\n" }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["static"]);
    });
  });

  it("does not call a configuration file a site with nothing to build", () => {
    // Both halves are required. A conf.py with no documents around it is
    // configuration for something else.
    withRepo({ "conf.py": "DEBUG = True\n" }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["unknown"]);
    });
    withRepo({ "hugo.toml": 'baseURL = "https://x.example/"\n' }, (repo) => {
      expect(values(detectFramework(repo), "framework")).toEqual(["unknown"]);
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

describe("shape", () => {
  it("calls a repository with a web framework a service", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { express: "^4" } }) }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["service"]);
    });
  });

  it("calls notebooks analysis, even when they are packaged", () => {
    withRepo({ "requirements.txt": "pandas==2.2.2\n", "study.ipynb": '{"cells":[]}' }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["notebook"]);
    });
  });

  it("calls a bin entry a command line tool", () => {
    withRepo({ "package.json": JSON.stringify({ bin: { thing: "./cli.js" } }), "cli.js": "" }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["cli"]);
    });
  });

  it("calls a package that declares how it is published a library", () => {
    withRepo({ "package.json": JSON.stringify({ main: "index.js", exports: "./index.js" }), "index.js": "" }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["library"]);
    });
  });

  it("does not call an npm init default a library", () => {
    // main: index.js on its own is what "npm init -y" writes, so it is not
    // evidence of anything.
    withRepo({ "package.json": JSON.stringify({ main: "index.js" }), "index.js": "" }, (repo) => {
      expect(values(detectShape(repo), "shape")).not.toEqual(["library"]);
    });
  });

  it("calls a loose source file a script only when nothing is declared", () => {
    withRepo({ "src/report.py": "print('hi')\n" }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["script"]);
    });
  });

  it("calls a repository of documents and nothing else static", () => {
    withRepo({ "README.md": "# handbook\n", "docs/onboarding.md": "# week one\n" }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["static"]);
    });
  });

  it("does not let one README speak for a repository of something else", () => {
    withRepo({ "README.md": "# dotfiles\n", "install.sh": "set -eu\n", "zsh/.zshrc": "\n", "Brewfile": "\n" }, (repo) => {
      expect(values(detectShape(repo), "shape")).toEqual(["unknown"]);
    });
  });

  it("says unknown, not script, when a project declares dependencies it does not recognize", () => {
    // Calling this a script routed it to the free function tier and quoted $0,
    // which is confidently wrong in the direction that costs the owner money.
    withRepo(
      { "requirements.txt": "some-unknown-web-thing==1.0\nanother-dep==2.0\n", "main.py": "x = 1\n" },
      (repo) => {
        const shape = detectShape(repo)[0];
        expect(shape?.values).toEqual(["unknown"]);
        expect(shape?.confidence).toBe("low");
      },
    );
  });
});

describe("sample and test material", () => {
  it("does not let a fixture directory stand in for the repository", () => {
    // Every signal used to be scavenged from whatever the fixtures contained,
    // so a repo with test material described a stack nobody deployed.
    withRepo(
      {
        "package.json": JSON.stringify({ bin: { thing: "./cli.js" } }),
        "cli.js": "",
        "fixtures/app/Gemfile": 'gem "rails"\ngem "sidekiq"\n',
        "fixtures/app/package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "examples/demo/requirements.txt": "torch==2.3.1\n",
        "testdata/sample/package.json": JSON.stringify({ dependencies: { express: "^4" } }),
      },
      (repo) => {
        expect(values(detectShape(repo), "shape")).toEqual(["cli"]);
        expect(values(detectJobs(repo), "jobs")).toEqual(["none"]);
        expect(detectApps(repo)[0]?.metric).toBe(0);
        expect(values(detectServerless(repo), "blocked_by")).toEqual(["none"]);
      },
    );
  });
});

describe("serverless fit", () => {
  it("fits when nothing needs to outlive a request", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { express: "^4" } }) }, (repo) => {
      expect(values(detectServerless(repo), "serverless_fit")).toEqual(["fits"]);
    });
  });

  it("is blocked by background work", () => {
    withRepo({ Gemfile: 'gem "sidekiq"\n' }, (repo) => {
      const signal = detectServerless(repo)[0];
      expect(signal?.values).toEqual(["blocked"]);
      expect(signal?.evidence).toContain("keeps running");
    });
  });

  it("is blocked by held open connections", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { "socket.io": "^4" } }) }, (repo) => {
      expect(detectServerless(repo)[0]?.evidence).toContain("holds connections open");
    });
  });

  it("is blocked by a local file database", () => {
    withRepo({ "requirements.txt": "Flask==3.0.3\n", "app.py": "import sqlite3\n" }, (repo) => {
      expect(detectServerless(repo)[0]?.evidence).toContain("disk that persists");
    });
  });

  it("is blocked by a runtime too heavy to cold start", () => {
    withRepo({ "requirements.txt": "torch==2.3.0\n" }, (repo) => {
      expect(detectServerless(repo)[0]?.evidence).toContain("cold start");
    });
  });
});

describe("commercial", () => {
  it("treats a payment processor as commercial", () => {
    withRepo({ "package.json": JSON.stringify({ dependencies: { stripe: "^15" } }) }, (repo) => {
      expect(values(detectCommercial(repo), "commercial")).toEqual(["yes"]);
    });
  });

  it("treats a pricing route as commercial even with no payment code", () => {
    withRepo({ "package.json": "{}", "app/pricing/page.tsx": "export default () => null;" }, (repo) => {
      expect(values(detectCommercial(repo), "commercial")).toEqual(["yes"]);
    });
  });

  it("says unclear rather than no, because absence proves nothing", () => {
    // A business can invoice outside the product and ship no payment code.
    withRepo({ "package.json": JSON.stringify({ dependencies: { next: "^14" } }) }, (repo) => {
      const signal = detectCommercial(repo)[0];
      expect(signal?.values).toEqual(["unclear"]);
      expect(signal?.confidence).toBe("low");
    });
  });
});

describe("apps", () => {
  it("counts one root per manifest that declares a framework", () => {
    withRepo(
      {
        "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
        "apps/web/package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "apps/api/package.json": JSON.stringify({ dependencies: { express: "^4" } }),
      },
      (repo) => {
        const signal = detectApps(repo)[0];
        expect(signal?.values).toEqual(["several"]);
        expect(signal?.metric).toBe(2);
      },
    );
  });

  it("does not count a shared package as a deployable app", () => {
    withRepo(
      {
        "apps/web/package.json": JSON.stringify({ dependencies: { next: "^14" } }),
        "packages/shared/package.json": JSON.stringify({ main: "index.js" }),
      },
      (repo) => {
        expect(detectApps(repo)[0]?.metric).toBe(1);
      },
    );
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
