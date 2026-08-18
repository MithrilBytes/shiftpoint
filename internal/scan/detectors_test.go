package scan

import (
	"reflect"
	"runtime"
	"slices"
	"strings"
	"testing"
)

// signalFor returns the signal reported for a field, failing the test when
// there is none.
func signalFor(t *testing.T, signals []Signal, field Field) Signal {
	t.Helper()
	for _, signal := range signals {
		if signal.Field == field {
			return signal
		}
	}
	t.Fatalf("no %s signal in %v", field, signals)
	return Signal{}
}

func TestEveryDetectorExplainsItself(t *testing.T) {
	// "A detector never guesses" only means something if a detector can show
	// its work. Every signal carries the evidence behind it, either way.
	repos := []map[string]string{
		{"package.json": `{"dependencies":{"express":"^4"}}`},
		{"notes.txt": "nothing to see"},
		{},
	}

	for _, files := range repos {
		signals := RunAll(build(t, files))
		if len(signals) == 0 {
			t.Fatal("no signals at all")
		}
		for _, signal := range signals {
			if signal.Evidence == "" {
				t.Errorf("%s does not explain itself", signal.Field)
			}
		}
	}
}

func TestCoverageRunsLast(t *testing.T) {
	// The list of files a read was refused for is only complete once every
	// other detector has tried to read them.
	last := Detectors[len(Detectors)-1]
	if nameOf(last) != nameOf(DetectCoverage) {
		t.Fatalf("last detector is %s, want DetectCoverage", nameOf(last))
	}
}

func TestARefusedReadReachesTheCoverageSignal(t *testing.T) {
	// This is the whole reason for the ordering. On a fresh repository nothing
	// has been read yet, so coverage on its own sees a clean scan. Run behind
	// the detectors that do the reading, it sees the gap they hit.
	files := map[string]string{"package.json": `{"dependencies":{"stripe":"^15"}}` + strings.Repeat(" ", maxReadBytes)}

	fresh := build(t, files)
	if got := signalFor(t, DetectCoverage(fresh), FieldScan).Values; !slices.Equal(got, []string{"complete"}) {
		t.Fatalf("a repository nobody has read yet reports %v, want [complete]", got)
	}

	scanned := signalFor(t, RunAll(build(t, files)), FieldScan)
	if !slices.Equal(scanned.Values, []string{"partial"}) {
		t.Errorf("got %v, want [partial]: the refusal never reached coverage", scanned.Values)
	}
}

func TestEveryDetectorIsRunExactlyOnce(t *testing.T) {
	seen := make(map[string]int, len(Detectors))
	for _, detect := range Detectors {
		if detect == nil {
			t.Fatal("a hole in the detector list")
		}
		seen[nameOf(detect)]++
	}

	for name, count := range seen {
		if count != 1 {
			t.Errorf("%s appears %d times", name, count)
		}
	}
	if len(seen) != len(Detectors) {
		t.Errorf("got %d distinct detectors from a list of %d", len(seen), len(Detectors))
	}
}

// nameOf identifies a detector by the function behind it, which is the only
// handle a func value offers.
func nameOf(detect Detector) string {
	return runtime.FuncForPC(reflect.ValueOf(detect).Pointer()).Name()
}
