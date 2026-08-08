# shiftpoint

Point shiftpoint at a repository and it tells you what infrastructure that
repository actually needs: whether a free tier covers it, what would push you
off that free tier, and what you are already paying for that nothing in the
code asks for.

The ladder starts at zero on purpose. For most small repositories the correct
answer is a free tier, and the useful thing to know is where that free tier
ends, not which server to rent.

Answers come in dollars and plain sentences. No CPU numbers, no percentiles, no
dashboards.

It reads files. It makes no network calls, ever.

## What it provides

### The question it answers

What can I run inside a free tier before I have to start paying for cloud, and
what specifically would push me over that line.

Alongside that, the reverse: what is in this repository that costs money or
attention with nothing in the code to justify it.

### What it reads

| Detector | Reads | Answers |
| --- | --- | --- |
| Language and framework | `package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py`, `Gemfile`, `go.mod`, and source file extensions | Next.js, Express, Flask, Django, Rails, static, or unknown |
| Shape | Notebooks, bin entries, console scripts, published entry points, source layout | Is this a service, a notebook, a library, a command line tool, a script, or a static site |
| Serverless fit | Queue libraries, socket libraries, machine learning runtimes, local file databases | Can this run on a free function tier, and if not, exactly what stops it |
| Database | Prisma schemas, Drizzle configs, dependency manifests, compose images, `DATABASE_URL` | Postgres, MySQL, SQLite, Mongo, or none |
| Payments | Stripe, Paddle, Lemon Squeezy, Braintree, PayPal in any manifest | Whether the free plans are licensed for what you are doing |
| Container | `Dockerfile`, `docker-compose.yml` | How it is packaged, and how many services it is really made of |
| Orchestration | Kubernetes manifests by shape, Helm charts, Terraform | What deployment machinery is checked in |
| Background jobs | Sidekiq, Resque, Celery, RQ, Dramatiq, BullMQ, and others | Whether work happens outside the request cycle |
| Static assets | Images, video, audio, fonts, documents | How much weight is checked in |
| CI | GitHub Actions, GitLab CI, CircleCI, Jenkins | Which CI service, if any |

Every signal carries a confidence level and the evidence behind it. A detector
never guesses. When it finds nothing it says so, and it lowers its confidence
when there was nothing to read in the first place.

### What it can tell you

Sixteen verdicts, matched most specific first. Everything below comes from
`rules/*.yaml`, so this table is data, not code.

| If your repository is | The verdict is |
| --- | --- |
| A notebook, a library, or a command line tool | There is nothing to host here |
| Sized by a machine learning model it loads | Deliberately not priced, because the cheapest servers cannot load it at all |
| A static site | Free static hosting, $0 |
| A script with nothing that must stay running | A free function tier, $0 |
| A stateless service, no payments | A free managed tier, $0 |
| A stateless service with a database | A free managed tier including the database, $0 |
| A stateless service that takes payments | About $20/mo, because the free plans are non commercial |
| A service with a single file database | One small always on server, $4 to $9/mo |
| A service with a managed database | A small server plus a managed database, $19 to $25/mo |
| A service with background work | An app server, a worker, and a database, $25 to $40/mo |
| Something it cannot identify | Said plainly, with no price attached |

The downward detection sits on top of that: Kubernetes manifests or a Helm
chart with no demand behind them, or a compose file describing a stack you rent
servers for when a free tier would host the same thing.

Demand comes only from what the application does, never from what the
deployment configuration asks for. A replica count of 50 is an intention, not
traffic, which is what lets the tool tell you a Kubernetes setup is unearned.

### The verdict format

Every verdict has the same four fields, in the same order, whether you read it
in the terminal, in INFRA.md, or as JSON.

**Stage.** What you need right now, with a price, or an explicit refusal to
price it.

**Headroom.** Roughly how far that carries you.

**Tripwire.** The specific thing that means it is time to look again, and what
the next step costs.

**Flags.** Spending and complexity the repository shows no demand for.

Under those four is a confidence level. When confidence is low, it says so
plainly rather than inventing a number.

When there is nothing worth changing, the verdict ends with the whole point of
the tool:

```
Do nothing today.
```

## Install

Requires Node 20 or newer.

```bash
npx shiftpoint
```

## Usage

```bash
npx shiftpoint
```

```
Stage:    A free managed tier covers this (est. $0/mo)
Headroom: Cloudflare Workers allows 100,000 requests a day free, and
          Vercel's free plan allows 100 GB of traffic a month, either
          of which is a long way off for a new app
Tripwire: If you start taking payments, the free plans are personal
          use only and you move to about $20/mo. If you outgrow the
          request limits first, the next step is about $5/mo.
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
npx shiftpoint ./some/repo
```

```bash
npx shiftpoint --write
```

```bash
npx shiftpoint --json
```

## Where the numbers come from

Every rule that quotes a dollar figure carries the source it came from and the
date that source was read. A price without a source is a guess, and the test
suite fails the build if a rule quotes money without citing one.

Current figures were read on 2026-08-04:

| Number | Source |
| --- | --- |
| Static hosting free and unlimited | Cloudflare Pages: static asset requests are free on both plans |
| 100,000 requests a day free | Cloudflare Workers free plan, 10ms CPU per invocation |
| 1,000,000 function requests a month, perpetually free | AWS Lambda always free tier, plus 400,000 GB-seconds |
| 100 GB transfer, 1M invocations, non commercial only | Vercel Hobby plan and its fair use guidelines |
| $20 per user per month | Vercel Pro |
| 0.5 GB free database | Neon free tier, per project |
| $4/mo server | DigitalOcean Basic Droplet |
| About $9.49/mo server | Hetzner CX22, after the April 2026 price change |
| $15/mo managed Postgres | DigitalOcean Managed Postgres, single node |
| About $73/mo Kubernetes control plane | Amazon EKS at $0.10 per hour, before any worker nodes |

Two free tiers this tool deliberately does not recommend: Fly.io and Railway
both ended theirs, and Render's survives but sleeps after 15 minutes of
inactivity.

## How it works

Four layers, kept separate because they change at different speeds.

**Detectors** (`src/detectors/`) are small pure functions over the file tree.
Each emits typed signals with a confidence score and the evidence behind them.

**Profile** (`src/profile.ts`) aggregates signals and derives the two answers
the tool turns on: how heavy the static assets are, and whether the repository
shows any demand at all.

**Rules** (`rules/*.yaml`) map profiles to verdicts. Every capacity prior, price
point, threshold, and sentence lives in these files. The engine holds no numbers
of its own.

**Renderers** (`src/render/`) turn one shared verdict object into terminal
output, INFRA.md, or JSON. Nothing renderer specific leaks upstream.

## Updating a price

Prices move, and free tiers disappear. Correcting one is a change to data, not
to code. In `rules/stages.yaml`:

```yaml
  - id: app-with-file-database
    cost_low: 4
    cost_high: 9
    source: "DigitalOcean Droplet $4/mo, Hetzner CX22 about $9.49/mo, read 2026-08-04"
```

Edit the number, update the source and its date, run `npm test`, open a pull
request. The prose picks the new value up through its `{cost_low}` placeholder,
so a price correction stays a small diff.

## Roadmap

Ordered roughly by how much each one would improve an answer today.

**Coverage gaps in what it recognizes**

- [ ] More frameworks: FastAPI, Astro, SvelteKit, Remix, Go and Rust web servers
- [ ] Bun and Deno as runtimes, including their own deploy targets
- [ ] Edge databases: Turso, Cloudflare D1, Supabase, PlanetScale
- [ ] Scheduled work as its own shape, since cron fits free tiers that long running work does not
- [ ] Monorepos, which today collapse to a single verdict for what may be several deployable apps

**Making the verdicts sharper**

- [ ] `--explain`, to print the evidence behind a verdict. Detectors already collect it and nothing surfaces it
- [ ] Warn when the prices in `rules/` were last checked more than six months ago
- [ ] Use the CI signal, which is detected today but no shipped rule reads
- [ ] A flag for Terraform that provisions managed Kubernetes, which the current Kubernetes flag misses
- [ ] Free tier eligibility beyond payments: team accounts and organisation ownership also disqualify personal plans

**Correctness work**

- [ ] Test on Windows. Paths are normalised for it but nothing has run there
- [ ] Handle vendored dependency directories with non standard names, which can swamp the file scan
- [ ] Distinguish a hobby project from a business, since the same code gets different advice

Deliberately out of scope: a GitHub Action, an MCP server, telemetry of any
kind, hosting provider integrations, config files, and a plugin system.

## Known limits

It reads code, not traffic. It cannot see your actual usage, your bill, or your
users, so every number is a prior drawn from the shape of the repository rather
than a measurement of your system. Treat the headroom figures as orders of
magnitude.

It assumes list pricing and ignores the discounts, credits, and free trials most
providers hand out.

It has no opinion about correctness, security, or whether your architecture is
any good. It answers one question: what does this cost to run, and what of that
cost is unearned.

## Contributing

```bash
npm install
```

```bash
npm test
```

Four things the test suite enforces mechanically:

The goldens are the specification. `goldens/*.md` and their fixtures in
`fixtures/` pin every verdict the tool can produce, and the CLI has to reproduce
each one byte for byte. Changing a verdict means changing a golden in the same
commit, deliberately.

Every rule that quotes a dollar figure has to cite a source and the date it was
read.

The tool stays offline. No source file may reference a network API, and the
runtime dependency list is checked against an allowlist. There is exactly one
runtime dependency, a YAML parser, because the rules are community edited data
and hand rolling a parser for them would be the worse trade.

No em dashes or en dashes anywhere in the repository. Run `npm run check:dashes`
to check. Use a comma, colon, period, or parentheses instead.

## License

MIT. See [LICENSE](LICENSE).
