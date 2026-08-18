package corpus_test

import (
	"os"
	"testing"

	"github.com/MithrilBytes/shiftpoint/corpus"
	"github.com/MithrilBytes/shiftpoint/rules"
)

func load(t *testing.T) ([]corpus.Case, corpus.Thresholds, *rules.RuleSet) {
	t.Helper()
	cases, err := corpus.Load("cases")
	if err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no corpus cases found")
	}
	thresholds, err := corpus.LoadThresholds("thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	set, err := rules.Load()
	if err != nil {
		t.Fatal(err)
	}
	return cases, thresholds, set
}

func TestCorpusIsStructurallySound(t *testing.T) {
	cases, _, set := load(t)

	stages := map[string]bool{}
	for _, stage := range set.Stages {
		stages[stage.ID] = true
	}
	flags := map[string]bool{}
	for _, flag := range set.Flags {
		flags[flag.ID] = true
	}

	seen := map[string]bool{}
	for _, testCase := range cases {
		switch {
		case testCase.ID == "":
			t.Error("a case has no id")
		case seen[testCase.ID]:
			t.Errorf("duplicate id %q", testCase.ID)
		case testCase.Origin == "":
			t.Errorf("%s has no origin", testCase.ID)
		case !stages[testCase.Expect.Stage]:
			t.Errorf("%s labels an unknown stage %q", testCase.ID, testCase.Expect.Stage)
		case len(testCase.Files) > 8:
			t.Errorf("%s has %d files, a case is a specimen not a repository", testCase.ID, len(testCase.Files))
		}
		seen[testCase.ID] = true
		for _, flag := range testCase.Expect.Flags {
			if !flags[flag] {
				t.Errorf("%s labels an unknown flag %q", testCase.ID, flag)
			}
		}
	}
}

func TestHoldoutIsWorthMeasuring(t *testing.T) {
	cases, _, _ := load(t)
	held := 0
	for _, testCase := range cases {
		if testCase.Split == corpus.Holdout {
			held++
		}
	}
	share := float64(held) / float64(len(cases))
	if share < 0.15 || share > 0.45 {
		t.Errorf("holdout is %.0f%% of %d cases", share*100, len(cases))
	}
}

// score runs one split and reports it.
func score(t *testing.T, split corpus.Split) (corpus.Score, corpus.Bar) {
	t.Helper()
	cases, thresholds, set := load(t)

	bar := thresholds.Tune
	if split == corpus.Holdout {
		bar = thresholds.Holdout
	}

	var result corpus.Score
	for _, testCase := range cases {
		if testCase.Split != split {
			continue
		}
		root := t.TempDir()
		if err := testCase.Materialize(root); err != nil {
			t.Fatal(err)
		}
		analysis, err := set.Analyze(root)
		if err != nil {
			t.Fatalf("%s: %v", testCase.ID, err)
		}

		stage := "none"
		if selected := set.SelectStage(analysis.Profile); selected != nil {
			stage = selected.ID
		}
		var flags []string
		for _, flag := range set.SelectFlags(analysis.Profile) {
			flags = append(flags, flag.ID)
		}
		result.Record(testCase, stage, flags)
	}
	return result, bar
}

func TestTuneAccuracy(t *testing.T) {
	result, bar := score(t, corpus.Tune)
	// Tune misses print, because tune is what you iterate against.
	for _, miss := range result.Misses {
		t.Log(miss)
	}
	t.Logf("tune: stage %.1f%%, flags %.1f%%, n=%d",
		result.Rate()*100, result.FlagRate()*100, result.Total)

	if result.Rate() < bar.Stage {
		t.Errorf("tune stage accuracy %.3f is below the floor of %.3f", result.Rate(), bar.Stage)
	}
	if result.FlagRate() < bar.Flags {
		t.Errorf("tune flag accuracy %.3f is below the floor of %.3f", result.FlagRate(), bar.Flags)
	}
}

func TestHoldoutAccuracy(t *testing.T) {
	result, bar := score(t, corpus.Holdout)
	// Holdout stays quiet on purpose. Printing the misses turns the held out
	// set into another thing to fit, and then it measures nothing.
	if os.Getenv("SHIFTPOINT_SHOW_HOLDOUT") == "1" {
		for _, miss := range result.Misses {
			t.Log(miss)
		}
	}
	t.Logf("holdout: stage %.1f%%, flags %.1f%%, n=%d",
		result.Rate()*100, result.FlagRate()*100, result.Total)

	if result.Rate() < bar.Stage {
		t.Errorf("holdout stage accuracy %.3f is below the floor of %.3f", result.Rate(), bar.Stage)
	}
	if result.FlagRate() < bar.Flags {
		t.Errorf("holdout flag accuracy %.3f is below the floor of %.3f", result.FlagRate(), bar.Flags)
	}
}

func TestSplitMatchesTheHashItAlwaysUsed(t *testing.T) {
	// The split has to survive the rewrite, or every case changes sides and
	// the holdout stops being held out.
	cases, _, _ := load(t)
	byID := map[string]corpus.Split{}
	for _, testCase := range cases {
		byID[testCase.ID] = testCase.Split
	}
	for id, want := range map[string]corpus.Split{
		"seed-rails-sidekiq":   corpus.Tune,
		"seed-express-k8s":     corpus.Tune,
		"node-discord-bot":     corpus.Tune,
		"python-django-sqlite": corpus.Tune,
	} {
		if got, ok := byID[id]; ok && got != want {
			t.Errorf("%s moved from %s to %s", id, want, got)
		}
	}
}
