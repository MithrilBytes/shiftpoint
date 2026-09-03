# shiftpoint

Point shiftpoint at a repository and it tells you what infrastructure that
repository actually needs: whether a free tier covers it, what would push you
off that free tier, and what you are already paying for that nothing in the
code asks for.

Output is a dollar figure and a few sentences of explanation, with no CPU
numbers, percentiles or dashboards. It is one binary with no runtime, and it
makes no network calls.

## What it reads

| Detector | Reads | Answers |
| --- | --- | --- |
| Language and framework | `package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py`, `Gemfile`, `go.mod`, `Cargo.toml`, `composer.json`, `mix.exs`, `pom.xml`, `build.gradle`, `deno.json`, `*.csproj`, and source file extensions | Node, Python, Ruby, Go, Rust, PHP, Elixir, Java, .NET, Deno, SQL, 38 web frameworks and eight static site generators |
| Shape | Notebooks, bin entries, console scripts, published entry points, source layout | Is this a service, a notebook, a library, a command line tool, a script, or a static site |
| Serverless fit | Queue libraries, socket and gateway clients, in process schedulers, machine learning runtimes, local file databases, runtimes no free tier offers | Can this run on a free function tier, and if not, which of ten reasons stops it |
| Database | Prisma schemas, Drizzle configs, dependency manifests, compose images, `DATABASE_URL`, Laravel, Ecto and Spring configuration, Entity Framework | Postgres, MySQL, SQLite, Mongo, D1, or none |
| Commercial | Payment processors, business tooling, pricing and checkout routes | Whether the free plans are licensed for what you are doing |
| Applications | Manifests that declare a web framework, per directory | How many separately deployable apps live here |
| Container | `Dockerfile`, `docker-compose.yml` | How it is packaged, and how many services it is really made of |
| Orchestration | Kubernetes manifests by shape, Helm charts, Terraform | What deployment machinery is checked in |
| Background jobs | Sidekiq, Resque, Celery, RQ, Dramatiq, BullMQ, asynq, and others | Whether work happens outside the request cycle |
| Static assets | Images, video, audio, fonts, documents | How much weight is checked in |
| CI | GitHub Actions, GitLab CI, CircleCI, Jenkins | Which CI service, if any |

Every signal carries a confidence level and the evidence behind it. A detector
that finds nothing reports that, at lower confidence when there were no files
to read.

## What it can tell you

Sixteen verdicts, matched most specific first, all of them from `rules/*.yaml`.
The ones you are most likely to meet:

| If your repository is | The verdict is |
| --- | --- |
| A notebook, a library, or a command line tool | There is nothing to host here |
| Sized by a machine learning model it loads | Not priced, because the cheapest servers cannot load it at all |
| A static site | Free static hosting, $0 |
| A script with nothing that must stay running | A free function tier, $0 |
| A stateless service with no sign of a business | A free managed tier, $0 |
| A stateless service with a database | A free managed tier including the database, $0 |
| A stateless service that looks like a business | About $20/mo, because the free plans are non commercial |
| A service with a single file database | One small always on server, $4 to $9/mo |
| A service with a managed database | A small server plus a managed database, $19 to $25/mo |
| A service with background work | An app server, a worker, and a database, $25 to $40/mo |
| Something it cannot identify | No price attached |

Flags are matched separately, against spending with no demand behind it:
Kubernetes manifests or a Helm chart with nothing in the code to justify them,
or a compose file describing a stack you rent servers for when a free tier
would host the same thing.

Demand comes from what the application does, not from what the deployment
configuration declares. A replica count of 50 does not change the verdict.

## The verdict format

Every verdict has the same four fields, in the same order, whether you read it
in the terminal, in INFRA.md, or as JSON.

**Stage.** What you need right now, with a price, or a statement that it cannot
be priced.

**Headroom.** Roughly how far that carries you.

**Tripwire.** The specific thing that means it is time to look again, and what
the next step costs.

**Flags.** Spending and complexity the repository shows no demand for.

Under those four is a confidence level. A low one is stated plainly, and the
headroom line says when the number behind it is a guess. The same line carries
caveats: things
that make the answer fit less well, such as a repository holding several
deployable applications when a verdict describes one system.

When there is nothing worth changing, the verdict ends with:

```
Do nothing today.
```

## Accuracy

Measured against 226 hand labelled cases in `corpus/`, each a small specimen of
a repository shape. Cases are split into tune and holdout by hashing the case
id.

| Split | Stage | Flags | Cases |
| --- | --- | --- | --- |
| Tune, which the tool is iterated against | 96.9% | 96.3% | 162 |
| Holdout, which it is not | 71.9% | 95.3% | 64 |

Stage accuracy is 25 points lower on holdout than on tune.

## Install

Requires Go 1.24 or newer to build. The result is a single binary with no
runtime to install.

```bash
go install github.com/MithrilBytes/shiftpoint/cmd/shiftpoint@latest
```

Or from a clone:

```bash
git clone https://github.com/MithrilBytes/shiftpoint.git
```

```bash
cd shiftpoint && go build -o shiftpoint ./cmd/shiftpoint
```

The rules ship inside the binary.

## Usage

```bash
shiftpoint
```

```
Stage:    A free managed tier covers this (est. $0/mo)
Headroom: Cloudflare Workers allows 100,000 requests a day free, and
          Vercel's free plan allows 100 GB of traffic a month, either
          of which is a long way off for a new app
Tripwire: Those free plans are licensed for personal, non commercial
          use, so the day this becomes a business it is about $20/mo
          whatever the traffic is doing. If you outgrow the request
          limits first, the next step is about $5/mo.
Flags:    Found Kubernetes manifests. The cluster alone is about
          $73/mo before a single server to run on, with no signal you
          need it yet.
          Found a Helm chart. It manages releases across a fleet of
          services, and this repository holds one.

Confidence: medium. Some of this is inferred from what the repository
does not contain.
```

Point it somewhere else, write the verdict into the repository, or get JSON:

```bash
shiftpoint ./some/repo
```

```bash
shiftpoint --write
```

```bash
shiftpoint --json
```

## Where the numbers come from

Every rule that quotes a dollar figure carries the source it came from and the
date that source was read. The test suite fails the build if a rule quotes
money without citing one.

Current figures were read on 2026-08-04:

| Number | Source |
| --- | --- |
| Static hosting free and unlimited | Cloudflare Pages: static asset requests are free and unlimited |
| 100,000 requests a day free | Cloudflare Workers free plan |
| 1,000,000 function requests a month, perpetually free | AWS Lambda always free tier, plus 400,000 GB-seconds |
| 100 GB transfer, 1M invocations, non commercial only | Vercel Hobby plan |
| $20 per user per month | Vercel Pro |
| 0.5 GB free database | Neon free tier, per project |
| $4/mo server | DigitalOcean Droplet |
| About $9.49/mo server | Hetzner CX22 |
| $15/mo managed Postgres | DigitalOcean Managed Postgres |
| About $73/mo Kubernetes control plane | Amazon EKS at $0.10 per hour, before any worker nodes |

Three providers this tool does not route to: Fly.io and Railway both ended
their free tiers, and Render's survives but sleeps after 15 minutes of
inactivity.

## How it works

Four layers, in the order a run goes through them.

**Detectors** (`internal/scan/`) are pure functions over the file tree. Each
emits typed signals with a confidence level and the evidence behind them.

**Profile** (`rules/profile.go`) aggregates signals into the fields the rules
match on, including how heavy the static assets are and whether the repository
shows any demand at all.

**Rules** (`rules/`) map profiles to verdicts. Capacity priors, price points,
thresholds and verdict sentences are in `rules/*.yaml`.

**Renderers** (`internal/render/`) turn the verdict into terminal output,
INFRA.md, or JSON.

`cmd/shiftpoint` is the entry point and hands argv to `internal/cli`. The rules
YAML is embedded with `go:embed`.

## Updating a price

In `rules/stages.yaml`:

```yaml
  - id: app-with-file-database
    cost_low: 4
    cost_high: 9
    source: "DigitalOcean Droplet $4/mo, Hetzner CX22 about $9.49/mo, read 2026-08-04"
```

Edit the number, update the source and its date, run `go test ./...`, open a
pull request. The prose picks the new value up through its `{cost_low}`
placeholder.

## Roadmap

**Coverage gaps in what it recognises**

- [ ] Per application verdicts in a monorepo. Several apps are detected today, but the answer covers them as one system
- [ ] Scheduled work as its own shape. Cron jobs are eligible for free function tiers that a long running process cannot use
- [ ] Kotlin, Scala, Swift and C++ services
- [ ] Managed queue services used in place of a queue library

**Making the verdicts sharper**

- [ ] `--explain`, to print the evidence behind a verdict. Detectors collect it and nothing surfaces it
- [ ] Use the CI signal, which is detected today but no shipped rule reads
- [ ] A flag for Terraform that provisions managed Kubernetes, which the current Kubernetes flag misses
- [ ] Free tier eligibility beyond payments: team accounts and organisation ownership also disqualify personal plans

**Keeping the prices honest**

- [x] Fail the build when a price has gone unchecked for six months
- [ ] A weekly job that checks each provider's pricing page and opens a pull request when a figure moves. It has to report not found separately from unchanged, or a page redesign leaves a stale price behind a passing build
- [ ] A machine readable source for the prices. Nine of the ten in the table above have none: cloud pricing APIs cover paid AWS, Azure and GCP rates, and nobody publishes free tier boundaries as data at all

**Correctness work**

- [x] Test on Windows
- [ ] Close the gap between the two corpus splits, currently 25 points
- [ ] Large checked in datasets still dominate the file scan. Nested checkouts and virtual environments are skipped, but a directory of ten thousand data files is read as repository content
- [ ] Resolve commercial intent rather than inferring it. A business that invoices outside the product ships no payment code, so today the verdict states the licensing condition rather than resolving it

**Distribution**

- [ ] Homebrew tap, scoop manifest and prebuilt binaries on the release page
- [ ] Reproducible release builds. The version already stamps through ldflags, but nothing produces the release binaries

Out of scope: a GitHub Action, an MCP server, telemetry of any kind, hosting
provider integrations, config files, and a plugin system.

## Known limits

shiftpoint reads source code. It cannot see your usage, your bill or your
users, so every number is a prior drawn from the shape of the repository rather
than a measurement of your system. Treat the headroom figures as orders of
magnitude.

It assumes list pricing and ignores the discounts, credits and free trials most
providers hand out.

It does not check correctness, security or architecture.

A runtime it does not recognise gets "we could not tell" rather than a number.

## Contributing

```bash
go test ./...
```

That runs the unit tests, the nine goldens byte for byte, the 226 corpus cases,
and the repository wide checks.

Six things the build enforces:

`goldens/*.md` and their fixtures in `fixtures/` pin eight of the sixteen
verdicts, and the CLI has to reproduce each one byte for byte. Changing a
pinned verdict means changing a golden in the same commit.

Every rule that quotes a dollar figure has to cite a source and the date it was
read.

A source older than six months fails the build.

`corpus/thresholds.yaml` holds the accuracy floor for each split, and a run
below it fails. Individual disagreements are counted and printed rather than
failed, so the number moves instead of one case breaking the build.

No em dashes or en dashes anywhere in the repository. `go test ./tools/checks`
checks it. Use a comma, colon, period, or parentheses instead.

`go:embed` puts the rules YAML in the executable, so a build without the rules
data does not compile.

## License

MIT. See [LICENSE](LICENSE).
