package rules

import (
	"regexp"
	"strings"
	"testing"
)

func load(t *testing.T) *RuleSet {
	t.Helper()
	set, err := Load()
	if err != nil {
		t.Fatalf("the shipped rules do not load: %v", err)
	}
	return set
}

func TestShippedRulesLoad(t *testing.T) {
	set := load(t)
	if len(set.Stages) != 16 {
		t.Errorf("got %d stages, want 16", len(set.Stages))
	}
	if len(set.Flags) == 0 {
		t.Error("no flags loaded")
	}
	if set.Thresholds.StaticHeavyBytes <= 0 {
		t.Error("no asset threshold loaded")
	}
}

func TestEveryStageIsReachable(t *testing.T) {
	// First match wins, so loosening an early rule can strand a later one. A
	// profile built from a rule's own conditions must select that rule.
	set := load(t)
	for _, stage := range set.Stages {
		fields := map[string][]string{}
		for field, allowed := range stage.When {
			fields[field] = []string{allowed[0]}
		}
		got := set.SelectStage(Profile{Fields: fields})
		if got == nil || got.ID != stage.ID {
			name := "nothing"
			if got != nil {
				name = got.ID
			}
			t.Errorf("stage %q is unreachable, shadowed by %s", stage.ID, name)
		}
	}
}

func TestEveryRuleHasAUniqueID(t *testing.T) {
	set := load(t)
	seen := map[string]bool{}
	for _, stage := range set.Stages {
		if seen[stage.ID] {
			t.Errorf("duplicate stage id %q", stage.ID)
		}
		seen[stage.ID] = true
	}
}

func TestEveryPlaceholderResolves(t *testing.T) {
	set := load(t)
	for _, stage := range set.Stages {
		for _, text := range []string{stage.Stage, stage.Headroom, stage.Tripwire} {
			if _, err := fill(text, stage.Scalars, stage.ID); err != nil {
				t.Error(err)
			}
		}
	}
	for _, flag := range set.Flags {
		if _, err := fill(flag.Text, flag.Scalars, flag.ID); err != nil {
			t.Error(err)
		}
	}
}

func TestEveryPricedRuleCitesASource(t *testing.T) {
	// The first version of these files shipped invented prices. A price
	// without a source is a guess, so sourcing is enforced rather than trusted.
	set := load(t)
	money := regexp.MustCompile(`\$\{?\w`)
	dated := regexp.MustCompile(`read \d{4}-\d{2}-\d{2}`)

	for _, stage := range set.Stages {
		prose := stage.Stage + " " + stage.Headroom + " " + stage.Tripwire
		if !money.MatchString(prose) {
			continue
		}
		if !dated.MatchString(stage.Scalars["source"]) {
			t.Errorf("stage %q quotes money with no dated source", stage.ID)
		}
	}
	for _, flag := range set.Flags {
		if money.MatchString(flag.Text) && !dated.MatchString(flag.Scalars["source"]) {
			t.Errorf("flag %q quotes money with no dated source", flag.ID)
		}
	}
}

func TestOnlyFlagsSpendingWithNoDemandBehindIt(t *testing.T) {
	set := load(t)
	for _, flag := range set.Flags {
		demand := flag.When["demand"]
		if len(demand) != 1 || demand[0] != "none" {
			t.Errorf("flag %q fires without requiring demand: none", flag.ID)
		}
	}
}

func TestTheVoiceOfTheRules(t *testing.T) {
	set := load(t)
	metric := regexp.MustCompile(`(?i)\b(CPU|vCPU|RPS|QPS|p50|p95|p99|IOPS|latency|throughput)\b`)
	withdrawn := regexp.MustCompile(`(?i)\b(fly\.io|railway)\b`)
	banned := regexp.MustCompile("[\\x{2014}\\x{2013}]")

	var prose []string
	for _, stage := range set.Stages {
		prose = append(prose, stage.Stage, stage.Headroom, stage.Tripwire)
	}
	for _, flag := range set.Flags {
		prose = append(prose, flag.Text)
	}
	for _, caveat := range set.Caveats {
		prose = append(prose, caveat.Text)
	}
	for _, note := range set.Notes {
		prose = append(prose, note)
	}

	for _, text := range prose {
		if metric.MatchString(text) {
			t.Errorf("an internal metric reached a founder: %q", text)
		}
		if withdrawn.MatchString(text) {
			t.Errorf("promises a free tier that no longer exists: %q", text)
		}
		if banned.MatchString(text) {
			t.Errorf("uses a dash this project bans: %q", text)
		}
	}
}

func TestAnAbstentionNeverAffirmsNoAction(t *testing.T) {
	// "Do nothing today." under "we could not tell what this runs" pairs an
	// admission of ignorance with approval of whatever is in there.
	set := load(t)
	for _, id := range []string{"known-language-only", "unknown", "model-runtime"} {
		stage := find(t, set, id)
		if stage.MayDoNothing() {
			t.Errorf("stage %q may close with the affirmative sentence", id)
		}
	}
	for _, id := range []string{"notebook", "library", "command-line-tool", "static-site"} {
		if !find(t, set, id).MayDoNothing() {
			t.Errorf("stage %q may not close with the affirmative sentence", id)
		}
	}
}

func TestEvaluateCapsConfidenceAtTheWeakestSignal(t *testing.T) {
	set := load(t)
	fields := map[string][]string{
		"shape":          {"service"},
		"serverless_fit": {"fits"},
		"commercial":     {"yes"},
	}

	strong, err := set.Evaluate(Profile{Fields: fields, Confidence: map[string]Confidence{
		"shape": High, "serverless_fit": High, "commercial": High,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if strong.Confidence != High {
		t.Errorf("got %v, want high", strong.Confidence)
	}

	weak, err := set.Evaluate(Profile{Fields: fields, Confidence: map[string]Confidence{
		"shape": High, "serverless_fit": Low, "commercial": High,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if weak.Confidence != Low {
		t.Errorf("got %v, want low", weak.Confidence)
	}
	if !strings.Contains(weak.ConfidenceNote, "Confidence: low.") {
		t.Errorf("the note does not say so plainly: %q", weak.ConfidenceNote)
	}
}

func TestNothingToHostIsNeverPriced(t *testing.T) {
	set := load(t)
	for _, shape := range []string{"notebook", "library", "cli"} {
		verdict, err := set.Evaluate(Profile{Fields: map[string][]string{"shape": {shape}}})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(verdict.Stage, "nothing to host here") {
			t.Errorf("shape %q: got %q", shape, verdict.Stage)
		}
		if strings.Contains(verdict.Stage, "$") {
			t.Errorf("shape %q quotes a price: %q", shape, verdict.Stage)
		}
	}
}

func TestFillNamesTheRuleWhenAPlaceholderIsMissing(t *testing.T) {
	_, err := fill("~{missing}", map[string]string{}, "stages.yaml: stage x")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "defines no missing") {
		t.Errorf("unhelpful message: %v", err)
	}
}

func TestSetMatchesEveryFieldAndAnyValue(t *testing.T) {
	fields := map[string][]string{"framework": {"nextjs"}, "database": {"postgres"}}
	cases := []struct {
		name string
		when Set
		want bool
	}{
		{"any listed value satisfies a field", Set{"framework": {"nextjs", "express"}}, true},
		{"every field must match", Set{"framework": {"nextjs"}, "database": {"mysql"}}, false},
		{"an absent field never matches", Set{"jobs": {"sidekiq"}}, false},
		{"an empty set matches everything", Set{}, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := testCase.when.Matches(fields); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func find(t *testing.T, set *RuleSet, id string) Stage {
	t.Helper()
	for _, stage := range set.Stages {
		if stage.ID == id {
			return stage
		}
	}
	t.Fatalf("no stage %q", id)
	return Stage{}
}
