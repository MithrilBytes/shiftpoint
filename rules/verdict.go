package rules

import (
	"fmt"
	"regexp"
	"strings"
)

// Verdict is the one object every renderer reads. The four contract fields come
// first and in this order, whatever the surface.
type Verdict struct {
	Stage    string
	Headroom string
	Tripwire string
	Flags    []string

	Confidence     Confidence
	ConfidenceNote string
	DoNothingToday bool
}

// Profile is what a scan adds up to: the fields rules match on, how sure each
// one is, and the evidence behind it.
type Profile struct {
	Fields     map[string][]string
	Confidence map[string]Confidence
	Evidence   map[string]string
}

// SelectStage returns the rung a profile lands on. Exposed separately from
// Evaluate because two rules can render identical prose, so the id is the only
// way to ask which one answered, which is what the corpus scores against.
func (r *RuleSet) SelectStage(profile Profile) *Stage {
	for i := range r.Stages {
		if r.Stages[i].When.Matches(profile.Fields) {
			return &r.Stages[i]
		}
	}
	return nil
}

// SelectFlags returns the flags a profile fires, in the order they are declared.
func (r *RuleSet) SelectFlags(profile Profile) []Flag {
	var fired []Flag
	for _, flag := range r.Flags {
		if flag.When.Matches(profile.Fields) {
			fired = append(fired, flag)
		}
	}
	return fired
}

// Evaluate maps a profile onto a verdict.
func (r *RuleSet) Evaluate(profile Profile) (Verdict, error) {
	stage := r.SelectStage(profile)
	if stage == nil {
		return Verdict{}, fmt.Errorf("rules: nothing matched, and the last stage has no empty when")
	}

	var flags []string
	for _, flag := range r.SelectFlags(profile) {
		text, err := fill(flag.Text, flag.Scalars, "flags.yaml: flag "+flag.ID)
		if err != nil {
			return Verdict{}, err
		}
		flags = append(flags, text)
	}

	confidence := weakest(stage, profile)
	note := r.Notes[confidence]
	for _, caveat := range r.Caveats {
		if caveat.When.Matches(profile.Fields) {
			note += " " + caveat.Text
		}
	}

	where := "stages.yaml: stage " + stage.ID
	verdict := Verdict{
		Flags:          flags,
		Confidence:     confidence,
		ConfidenceNote: note,
		// Flags are things to remove, so with none of them there is nothing to
		// remove. The rule still has to be one that reached an answer: a
		// verdict that could not identify the repository is in no position to
		// affirm that nothing needs changing.
		DoNothingToday: len(flags) == 0 && stage.MayDoNothing(),
	}

	var err error
	if verdict.Stage, err = fill(stage.Stage, stage.Scalars, where); err != nil {
		return Verdict{}, err
	}
	if verdict.Headroom, err = fill(stage.Headroom, stage.Scalars, where); err != nil {
		return Verdict{}, err
	}
	if verdict.Tripwire, err = fill(stage.Tripwire, stage.Scalars, where); err != nil {
		return Verdict{}, err
	}
	return verdict, nil
}

// weakest caps a verdict at the least certain signal it leaned on. A rule is
// only as good as the fields it matched.
func weakest(stage *Stage, profile Profile) Confidence {
	rank := map[Confidence]int{Low: 0, Medium: 1, High: 2}
	worst := stage.Confidence
	for field := range stage.When {
		level, ok := profile.Confidence[field]
		if !ok {
			level = Low
		}
		if rank[level] < rank[worst] {
			worst = level
		}
	}
	return worst
}

var placeholder = regexp.MustCompile(`\{(\w+)\}`)

// fill substitutes {braces} from the scalars on the same rule.
func fill(text string, scalars map[string]string, where string) (string, error) {
	var missing string
	filled := placeholder.ReplaceAllStringFunc(text, func(match string) string {
		key := strings.Trim(match, "{}")
		value, ok := scalars[key]
		if !ok {
			missing = key
			return match
		}
		return value
	})
	if missing != "" {
		return "", fmt.Errorf("%s uses {%s} but defines no %s", where, missing, missing)
	}
	return filled, nil
}
