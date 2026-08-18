package scan

import (
	"slices"
	"strings"
	"testing"
)

func TestDetectCoverageReportsACompleteRead(t *testing.T) {
	repo := build(t, map[string]string{"main.go": "package main", "go.mod": "module x"})

	scanned := signalFor(t, DetectCoverage(repo), FieldScan)
	if !slices.Equal(scanned.Values, []string{"complete"}) {
		t.Errorf("got %v, want [complete]", scanned.Values)
	}
	if scanned.Evidence != "read all 2 files" {
		t.Errorf("got %q, want it to count the files", scanned.Evidence)
	}
}

func TestDetectCoverageReportsARefusedRead(t *testing.T) {
	// A file too large to read looks exactly like a file that is not there, so
	// the blind spot is reported rather than counted as a finding.
	repo := build(t, map[string]string{"requirements.txt": strings.Repeat("#", maxReadBytes+1)})
	repo.Read("requirements.txt")

	scanned := signalFor(t, DetectCoverage(repo), FieldScan)
	if !slices.Equal(scanned.Values, []string{"partial"}) {
		t.Errorf("got %v, want [partial]", scanned.Values)
	}
	if !strings.Contains(scanned.Evidence, "1 file(s) too large to read, including requirements.txt") {
		t.Errorf("evidence does not name the file: %q", scanned.Evidence)
	}
}

func TestDetectCoverageReportsATruncatedWalk(t *testing.T) {
	// Constructed rather than walked: the alternative is writing twenty
	// thousand files to say one thing.
	repo := &Repo{Files: []string{"a.go", "b.go"}, truncated: true}

	scanned := signalFor(t, DetectCoverage(repo), FieldScan)
	if !slices.Equal(scanned.Values, []string{"partial"}) {
		t.Errorf("got %v, want [partial]", scanned.Values)
	}
	if !strings.Contains(scanned.Evidence, "stopped after 2 files") {
		t.Errorf("evidence does not say where it stopped: %q", scanned.Evidence)
	}
}

func TestDetectCoverageReportsBothGapsAtOnce(t *testing.T) {
	repo := build(t, map[string]string{"requirements.txt": strings.Repeat("#", maxReadBytes+1)})
	repo.Read("requirements.txt")
	repo.truncated = true

	evidence := signalFor(t, DetectCoverage(repo), FieldScan).Evidence
	if !strings.Contains(evidence, "stopped after") || !strings.Contains(evidence, "too large to read") {
		t.Errorf("only one gap was reported: %q", evidence)
	}
}
