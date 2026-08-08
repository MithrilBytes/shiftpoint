# shiftpoint

Point shiftpoint at a repository and it tells you what infrastructure that
repository actually needs: what stage you are at, how much headroom you have,
what would push you to the next step, and what you are paying for that nothing
in the code asks for.

Answers come in dollars and plain sentences. No CPU numbers, no percentiles, no
dashboards.

It reads files. It makes no network calls, ever.

## Install

Requires Node 20 or newer.

```bash
npx shiftpoint
```

Or install it:

```bash
npm install -g shiftpoint
```

## Usage

Run it in a repository:

```bash
npx shiftpoint
```

```
Stage:    Single small VPS is sufficient (est. $12-20/mo)
Headroom: This stack typically serves ~5k daily users at this tier
Tripwire: If you add background jobs or exceed ~50GB/mo bandwidth,
          revisit. Next tier is ~$40/mo.
Flags:    Found Kubernetes manifests. Adds ~$70/mo and ops burden with
          no signal you need it yet.
          Found a Helm chart. It manages releases across a fleet of
          services, and this repository holds one.

Confidence: medium. Some of this is inferred from what the repository
does not contain.
```

Other options:

```bash
npx shiftpoint ./some/repo
```

```bash
npx shiftpoint --write
```

```bash
npx shiftpoint --json
```

`--write` puts the verdict in INFRA.md inside the repository you analyzed.
`--json` prints it for machines.

## The verdict format

Every verdict has the same four fields, in the same order, whether you read it
in the terminal, in INFRA.md, or as JSON.

**Stage.** What you need right now, with a price.

**Headroom.** Roughly how far that carries you.

**Tripwire.** The specific thing that means it is time to look again, and what
the next step costs.

**Flags.** Spending and complexity the repository shows no demand for. This is
the part most tools skip. A Kubernetes manifest is not evidence that you need
Kubernetes: a replica count is an intention, not traffic.

Under those four is a confidence level. When confidence is low, it says so
plainly rather than inventing a number.

When there is nothing worth changing, the verdict ends with the whole point of
the tool:

```
Do nothing today.
```

## How it works

Four layers, kept separate because they change at different speeds.

**Detectors** (`src/detectors/`) are small pure functions. Each one reads
specific files (`package.json`, `Dockerfile`, `docker-compose.yml`, Kubernetes
manifests, Helm charts, Terraform, Prisma and Drizzle schemas, dependency
manifests, `.github/workflows`) and emits a typed signal with a confidence
score. A detector never guesses. When it finds nothing it says so, and it lowers
its confidence when there was nothing to read in the first place.

**Profile** (`src/profile.ts`) aggregates signals into the shape rules match
against, including the two derived answers the tool turns on: how heavy the
static assets are, and whether the repository shows any demand at all.

**Rules** (`rules/*.yaml`) map profiles to verdicts. Every capacity prior, price
point, threshold, and sentence lives in these files. The engine holds no numbers
of its own.

**Renderers** (`src/render/`) turn one shared verdict object into terminal
output, INFRA.md, or JSON. Nothing renderer specific leaks upstream.

## Updating a price

Prices move. Correcting one is a change to data, not to code. In
`rules/stages.yaml`:

```yaml
  - id: app-without-database
    cost_low: 12
    cost_high: 20
```

Edit the number, run `npm test`, open a pull request. The prose picks the new
value up through its `{cost_low}` placeholder, so a price correction stays a one
line diff.

## Contributing

```bash
npm install
```

```bash
npm test
```

Three things the test suite enforces mechanically:

The goldens are the specification. `goldens/*.md` were written by hand before
any detector existed, and the CLI has to reproduce each one byte for byte
against its fixture in `fixtures/`. Changing a verdict means changing a golden
in the same commit, deliberately.

The tool stays offline. No source file may reference a network API, and the
runtime dependency list is checked against an allowlist. There is exactly one
runtime dependency, a YAML parser, because the rules are community edited data
and hand rolling a parser for them would be the worse trade.

No em dashes or en dashes anywhere in the repository. Run `npm run check:dashes`
to check. Use a comma, colon, period, or parentheses instead.

## License

MIT. See [LICENSE](LICENSE).
