package rules_test

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/MithrilBytes/shiftpoint/internal/render"
	"github.com/MithrilBytes/shiftpoint/rules"
)

// The goldens are the specification. They were written by hand before any
// detector existed, and every implementation of this tool has to reproduce them
// byte for byte. For a rewrite they are the oracle: if the Go build renders the
// same bytes as the TypeScript did, the port preserved behaviour.

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestGoldens(t *testing.T) {
	root := repoRoot(t)
	entries, err := os.ReadDir(filepath.Join(root, "fixtures"))
	if err != nil {
		t.Fatal(err)
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) != 9 {
		t.Fatalf("got %d fixtures, want 9: %v", len(names), names)
	}

	set, err := rules.Load()
	if err != nil {
		t.Fatal(err)
	}

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			analysis, err := set.Analyze(filepath.Join(root, "fixtures", name))
			if err != nil {
				t.Fatal(err)
			}
			want, err := os.ReadFile(filepath.Join(root, "goldens", name+".md"))
			if err != nil {
				t.Fatal(err)
			}
			got := render.Markdown(analysis.Verdict)
			if got != string(want) {
				t.Errorf("golden mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
			}
		})
	}
}

func TestDownwardDetection(t *testing.T) {
	root := repoRoot(t)
	set, err := rules.Load()
	if err != nil {
		t.Fatal(err)
	}

	flagged, err := set.Analyze(filepath.Join(root, "fixtures", "k8s-overkill"))
	if err != nil {
		t.Fatal(err)
	}
	if len(flagged.Verdict.Flags) != 2 {
		t.Errorf("got %d flags, want 2", len(flagged.Verdict.Flags))
	}
	if flagged.Verdict.DoNothingToday {
		t.Error("a repository with something to remove was told to do nothing")
	}

	// The same machinery, once the repository shows it needs it.
	earned, err := set.Analyze(filepath.Join(root, "fixtures", "rails-sidekiq"))
	if err != nil {
		t.Fatal(err)
	}
	if len(earned.Verdict.Flags) != 0 {
		t.Errorf("flagged a repository with demand behind it: %v", earned.Verdict.Flags)
	}
}

func TestShiftpointOnItself(t *testing.T) {
	// A tool that gets its own repository wrong is not trustworthy about
	// anyone else's.
	analysis, err := rules.Analyze(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(analysis.Verdict.Stage, "nothing to host here") {
		t.Errorf("got %q", analysis.Verdict.Stage)
	}
	if strings.Contains(analysis.Verdict.Stage, "$") {
		t.Errorf("priced itself: %q", analysis.Verdict.Stage)
	}
	// Fixtures carry sidekiq, torch and sqlite. None of them is shiftpoint's.
	for _, field := range []string{"jobs", "database", "orchestration"} {
		if values := analysis.Profile.Fields[field]; len(values) != 1 || values[0] != "none" {
			t.Errorf("inherited a fixture's %s: %v", field, values)
		}
	}
}
