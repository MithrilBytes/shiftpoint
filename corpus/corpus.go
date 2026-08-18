// Package corpus scores the tool against hand labelled repositories.
//
// The goldens measure whether a verdict has CHANGED. This measures whether it
// is RIGHT, which is a different question and the one nothing else answers.
//
// Cases split into tune and holdout by hashing the case id, so nobody chooses
// which side a case lands on and no case can be moved to make a number look
// better. Tune is what you iterate against. Holdout is the only honest number
// anyone has.
package corpus

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Split is which half of the corpus a case belongs to.
type Split string

const (
	Tune    Split = "tune"
	Holdout Split = "holdout"
)

// Case is a small repository and the verdict a reviewer says it deserves.
type Case struct {
	ID     string `yaml:"id"`
	Origin string `yaml:"origin"`
	Expect struct {
		Stage string   `yaml:"stage"`
		Flags []string `yaml:"flags"`
	} `yaml:"expect"`
	Files map[string]string `yaml:"files"`

	Split Split `yaml:"-"`
}

// Thresholds is the accuracy the suite requires. They stop regression. They do
// not certify quality, and the honest way to raise one is to improve the tool
// until the number moves on its own.
type Thresholds struct {
	Tune    Bar `yaml:"tune"`
	Holdout Bar `yaml:"holdout"`
}

// Bar is one split's floor.
type Bar struct {
	Stage float64 `yaml:"stage"`
	Flags float64 `yaml:"flags"`
}

// splitOf is FNV-1a over the case id. Deterministic, and not something a
// contributor picks. It matches the hash the TypeScript implementation used, so
// a case stays on the side of the line it has always been on.
func splitOf(id string) Split {
	var hash uint32 = 0x811c9dc5
	for _, r := range id {
		hash ^= uint32(r)
		hash *= 0x01000193
	}
	if hash%10 < 3 {
		return Holdout
	}
	return Tune
}

// Load reads every case in a directory.
func Load(dir string) ([]Case, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var cases []Case
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var testCase Case
		if err := yaml.Unmarshal(raw, &testCase); err != nil {
			return nil, fmt.Errorf("%s: %w", entry.Name(), err)
		}
		testCase.Split = splitOf(testCase.ID)
		cases = append(cases, testCase)
	}
	sort.Slice(cases, func(i, j int) bool { return cases[i].ID < cases[j].ID })
	return cases, nil
}

// LoadThresholds reads the accuracy floors.
func LoadThresholds(path string) (Thresholds, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Thresholds{}, err
	}
	var thresholds Thresholds
	return thresholds, yaml.Unmarshal(raw, &thresholds)
}

// Materialize writes a case to disk and returns the directory.
func (c Case) Materialize(root string) error {
	for path, content := range c.Files {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// Score is how one split did.
type Score struct {
	Total  int
	Stage  int
	Flags  int
	Misses []string
}

// Rate is the share of cases whose stage was named correctly.
func (s Score) Rate() float64 {
	if s.Total == 0 {
		return 0
	}
	return float64(s.Stage) / float64(s.Total)
}

// FlagRate is the share of cases whose flags matched exactly.
func (s Score) FlagRate() float64 {
	if s.Total == 0 {
		return 0
	}
	return float64(s.Flags) / float64(s.Total)
}

// Record adds one case's outcome.
func (s *Score) Record(testCase Case, gotStage string, gotFlags []string) {
	s.Total++
	if gotStage == testCase.Expect.Stage {
		s.Stage++
	} else {
		s.Misses = append(s.Misses,
			fmt.Sprintf("%s: labelled %s, got %s", testCase.ID, testCase.Expect.Stage, gotStage))
	}

	want := append([]string(nil), testCase.Expect.Flags...)
	sort.Strings(want)
	got := append([]string(nil), gotFlags...)
	sort.Strings(got)
	if strings.Join(want, ",") == strings.Join(got, ",") {
		s.Flags++
	} else {
		s.Misses = append(s.Misses,
			fmt.Sprintf("%s: flags labelled %v, got %v", testCase.ID, want, got))
	}
}
