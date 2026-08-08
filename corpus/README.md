# Corpus

The goldens and the stack tests measure whether a verdict has **changed**. This
measures whether it is **right**.

That distinction is not academic. Every wrong answer this project has found so
far was found by a person running the tool on a repository and reading the
output. The test suite, which is large, has never once found one. A corpus
produces a number instead of a hunch.

## What a case is

One YAML file per case in `cases/`, holding a small repository and the verdict a
reviewer says it deserves.

```yaml
id: rails-sidekiq-postgres
origin: "Typical Rails SaaS: web plus worker plus managed Postgres."
expect:
  stage: app-with-background-work
  flags: []
files:
  Gemfile: |
    source "https://rubygems.org"
    gem "rails", "~> 7.1"
    gem "sidekiq"
    gem "pg"
```

`expect.stage` is a rule id from `rules/stages.yaml`. `expect.flags` is the exact
set of flag ids from `rules/flags.yaml` that should fire, or `[]`.

A case is a specimen, not a repository: at most eight files, each a few lines.

## How to label

**Write the case first, from a pattern that really exists. Then decide the
label by reading what the repository is.** Never run shiftpoint first and record
its answer, because a corpus assembled that way measures only that the tool
agrees with itself.

**Never adjust a label to make a test pass.** If the tool disagrees with a
label, the label stands and the case fails. A failing case is information. A
corpus that was green the day it landed measured nothing.

If a case is genuinely ambiguous, it does not belong here. Ambiguity is real,
but a corpus is for questions with answers.

## Tune and holdout

Every case lands in `tune` or `holdout` by hashing its id, so nobody chooses
which side a case falls on and no case can be moved to make a number look
better.

Tune misses print when the suite runs, because tune is what you iterate
against. Holdout misses stay quiet unless you ask:

```bash
SHIFTPOINT_SHOW_HOLDOUT=1 npx vitest run test/corpus.test.ts
```

Look at holdout misses when you want to know how you are doing. Do not fix them
one by one, because that is how a held out set stops being held out.

## The thresholds

`thresholds.yaml` holds the accuracy the suite requires. They exist to stop
regression, not to certify quality, and the honest way to raise one is to
improve the tool until the number moves on its own.

## When to add a case here rather than a fixture

Add a **fixture** when you want one verdict pinned byte for byte, including its
exact prose. There are nine, and they are expensive.

Add a **corpus case** when you want to know whether a shape of repository gets
the right answer. They are cheap, and there should be hundreds.
