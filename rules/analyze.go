package rules

import (
	"github.com/MithrilBytes/shiftpoint/internal/scan"
)

// Analysis is a verdict and the profile it came from. The profile is returned
// because the corpus scores against which rule answered, and two rules can
// render identical prose.
type Analysis struct {
	Profile Profile
	Verdict Verdict
}

// Analyze reads a repository and returns its verdict. Every layer runs here in
// order: scan, profile, rules. Nothing in this path touches the network.
func Analyze(root string) (Analysis, error) {
	set, err := Load()
	if err != nil {
		return Analysis{}, err
	}
	return set.Analyze(root)
}

// Analyze runs one repository through an already loaded rule set, which is what
// a batch of corpus cases wants.
func (r *RuleSet) Analyze(root string) (Analysis, error) {
	repo, err := scan.Open(root)
	if err != nil {
		return Analysis{}, err
	}
	profile := BuildProfile(scan.RunAll(repo), r.Thresholds)
	verdict, err := r.Evaluate(profile)
	if err != nil {
		return Analysis{}, err
	}
	return Analysis{Profile: profile, Verdict: verdict}, nil
}
