// Package rules maps what a scan found onto a verdict.
//
// Every capacity prior, price point, threshold and sentence lives in the YAML
// files beside this code. The engine holds no numbers of its own, so correcting
// a price is a change to data and a contributor can send one without reading
// any Go.
//
// The data is embedded at build time. A binary therefore cannot ship without
// its rules, which is a class of bug the previous implementation had: it
// resolved the rules directory at run time and silently fell back to the source
// checkout, so a build with no data passed every test and failed on every
// machine that was not the one it was built on.
package rules

import (
	"embed"
	"fmt"

	"gopkg.in/yaml.v3"
)

//go:embed *.yaml
var data embed.FS

// Confidence mirrors scan.Confidence as it appears in the data files.
type Confidence string

const (
	Low    Confidence = "low"
	Medium Confidence = "medium"
	High   Confidence = "high"
)

// Set is a rule's conditions: every field must match, and any one of a field's
// listed values satisfies it.
type Set map[string][]string

// Matches reports whether a profile satisfies every condition in the set.
func (s Set) Matches(fields map[string][]string) bool {
	for field, allowed := range s {
		if !intersects(fields[field], allowed) {
			return false
		}
	}
	return true
}

func intersects(have, allowed []string) bool {
	for _, value := range have {
		for _, candidate := range allowed {
			if value == candidate {
				return true
			}
		}
	}
	return false
}

// Stage is one rung of the ladder: what a repository of this shape needs, with
// a price or an explicit refusal to name one.
type Stage struct {
	ID         string     `yaml:"id"`
	When       Set        `yaml:"when"`
	Confidence Confidence `yaml:"confidence"`
	Stage      string     `yaml:"stage"`
	Headroom   string     `yaml:"headroom"`
	Tripwire   string     `yaml:"tripwire"`

	// DoNothing reports whether this verdict may close with "Do nothing
	// today.". A rule that abstains, or that asks the reader to go and find
	// something out, says no rather than contradicting itself.
	DoNothing *bool `yaml:"do_nothing"`

	Scalars map[string]string `yaml:"-"`
}

// Flag is spending or complexity a repository shows no demand for.
type Flag struct {
	ID      string            `yaml:"id"`
	When    Set               `yaml:"when"`
	Text    string            `yaml:"text"`
	Scalars map[string]string `yaml:"-"`
}

// Caveat rides on the confidence line. It says the answer fits less well, which
// is a different thing from the evidence being thin.
type Caveat struct {
	ID   string `yaml:"id"`
	When Set    `yaml:"when"`
	Text string `yaml:"text"`
}

// Thresholds are the numbers the profile applies when turning raw measurements
// into something a rule can match.
type Thresholds struct {
	StaticHeavyBytes int64 `yaml:"static_heavy_bytes"`
}

// Set holds every rule the engine reads.
type RuleSet struct {
	Stages     []Stage
	Flags      []Flag
	Caveats    []Caveat
	Thresholds Thresholds
	Notes      map[Confidence]string
}

// Load reads the embedded rules. It returns an error rather than panicking so a
// malformed contribution names itself instead of crashing in front of a user.
func Load() (*RuleSet, error) {
	set := &RuleSet{}

	var stages struct {
		Stages []yaml.Node `yaml:"stages"`
	}
	if err := read("stages.yaml", &stages); err != nil {
		return nil, err
	}
	for index, node := range stages.Stages {
		stage := Stage{}
		if err := node.Decode(&stage); err != nil {
			return nil, fmt.Errorf("stages.yaml: stage %d: %w", index+1, err)
		}
		if err := stage.validate(); err != nil {
			return nil, err
		}
		stage.Scalars = scalarsOf(node)
		set.Stages = append(set.Stages, stage)
	}
	if len(set.Stages) == 0 {
		return nil, fmt.Errorf("stages.yaml: no stages defined")
	}
	if last := set.Stages[len(set.Stages)-1]; len(last.When) != 0 {
		return nil, fmt.Errorf("stages.yaml: the last stage %q needs an empty when, so every repository gets an answer", last.ID)
	}

	var flags struct {
		Flags []yaml.Node `yaml:"flags"`
	}
	if err := read("flags.yaml", &flags); err != nil {
		return nil, err
	}
	for index, node := range flags.Flags {
		flag := Flag{}
		if err := node.Decode(&flag); err != nil {
			return nil, fmt.Errorf("flags.yaml: flag %d: %w", index+1, err)
		}
		if flag.ID == "" || flag.Text == "" {
			return nil, fmt.Errorf("flags.yaml: flag %d needs an id and a text", index+1)
		}
		flag.Scalars = scalarsOf(node)
		set.Flags = append(set.Flags, flag)
	}

	var profile struct {
		Thresholds Thresholds `yaml:"thresholds"`
	}
	if err := read("profile.yaml", &profile); err != nil {
		return nil, err
	}
	if profile.Thresholds.StaticHeavyBytes <= 0 {
		return nil, fmt.Errorf("profile.yaml: thresholds.static_heavy_bytes must be a positive number")
	}
	set.Thresholds = profile.Thresholds

	var confidence struct {
		Notes   map[string]string `yaml:"notes"`
		Caveats []Caveat          `yaml:"caveats"`
	}
	if err := read("confidence.yaml", &confidence); err != nil {
		return nil, err
	}
	set.Notes = map[Confidence]string{}
	for _, level := range []Confidence{Low, Medium, High} {
		note, ok := confidence.Notes[string(level)]
		if !ok || note == "" {
			return nil, fmt.Errorf("confidence.yaml: notes.%s must be a sentence", level)
		}
		set.Notes[level] = note
	}
	set.Caveats = confidence.Caveats

	return set, nil
}

func (s Stage) validate() error {
	where := fmt.Sprintf("stages.yaml: stage %q", s.ID)
	switch {
	case s.ID == "":
		return fmt.Errorf("stages.yaml: a stage is missing its id")
	case s.When == nil:
		return fmt.Errorf("%s is missing a when block, use {} to match every repository", where)
	case s.Stage == "", s.Headroom == "", s.Tripwire == "":
		return fmt.Errorf("%s needs a stage, a headroom and a tripwire", where)
	case s.Confidence != Low && s.Confidence != Medium && s.Confidence != High:
		return fmt.Errorf("%s needs a confidence of high, medium or low", where)
	}
	return nil
}

// MayDoNothing reports whether this stage is entitled to close with the
// closing sentence. Absent from the data means yes, because most verdicts are
// an answer.
func (s Stage) MayDoNothing() bool { return s.DoNothing == nil || *s.DoNothing }

// scalarsOf collects every scalar on a rule, so its prose can reference them
// with {braces}. A price is then a one line numeric diff rather than an edit to
// a sentence.
func scalarsOf(node yaml.Node) map[string]string {
	scalars := map[string]string{}
	for i := 0; i+1 < len(node.Content); i += 2 {
		key, value := node.Content[i], node.Content[i+1]
		if value.Kind == yaml.ScalarNode {
			scalars[key.Value] = value.Value
		}
	}
	return scalars
}

func read(name string, into any) error {
	raw, err := data.ReadFile(name)
	if err != nil {
		return fmt.Errorf("rules: %s is not embedded: %w", name, err)
	}
	if err := yaml.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("%s is not valid YAML: %w", name, err)
	}
	return nil
}
