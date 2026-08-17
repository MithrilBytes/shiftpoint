// Package scan reads a repository and reports what it finds.
//
// Every detector is a pure function over a Repo. It returns Signals: a typed
// finding, the evidence behind it, and how sure it is. A detector never
// guesses. When it finds nothing it says so, and it lowers its confidence when
// there was nothing to read in the first place.
package scan

// Confidence is how much weight a finding carries. It is ordered, so the
// weakest signal a verdict leans on can cap the whole answer.
type Confidence uint8

const (
	Low Confidence = iota
	Medium
	High
)

func (c Confidence) String() string {
	switch c {
	case High:
		return "high"
	case Medium:
		return "medium"
	default:
		return "low"
	}
}

// Weakest returns the lowest confidence in the set, or High when the set is
// empty. A verdict is never more certain than the evidence under it.
func Weakest(levels ...Confidence) Confidence {
	worst := High
	for _, level := range levels {
		if level < worst {
			worst = level
		}
	}
	return worst
}

// Field names a thing rules can match on. Declaring them as constants rather
// than loose strings means a typo in the engine is a compile error. A typo in
// rules/*.yaml is data, and is caught by the vocabulary test instead.
type Field string

const (
	FieldLanguage      Field = "language"
	FieldFramework     Field = "framework"
	FieldShape         Field = "shape"
	FieldApps          Field = "apps"
	FieldDatabase      Field = "database"
	FieldContainer     Field = "container"
	FieldOrchestration Field = "orchestration"
	FieldJobs          Field = "jobs"
	FieldServerlessFit Field = "serverless_fit"
	FieldBlockedBy     Field = "blocked_by"
	FieldCommercial    Field = "commercial"
	FieldAssets        Field = "assets"
	FieldDemand        Field = "demand"
	FieldCI            Field = "ci"
	FieldScan          Field = "scan"

	// Measured rather than classified. The profile turns these into a Field a
	// rule can match, because the threshold that does so is a number and
	// numbers live in rules/.
	FieldAssetBytes  Field = "asset_bytes"
	FieldAppServices Field = "app_services"
)

// None is the value every detector uses to report an absence, so a rule can
// match on "there is no database" the same way it matches on "postgres".
const None = "none"

// Signal is one finding from one detector.
type Signal struct {
	Field      Field
	Values     []string
	Confidence Confidence
	Evidence   string

	// Metric carries a raw measurement for detectors that count rather than
	// classify. Thresholds are applied in the profile, not here.
	Metric int
}

// Found reports a set of values with the evidence behind them.
func Found(field Field, confidence Confidence, evidence string, values ...string) Signal {
	return Signal{Field: field, Values: values, Confidence: confidence, Evidence: evidence}
}

// Absent reports that a detector looked and found nothing. The confidence
// belongs to the caller because absence proves more when there was something
// to read: no database client in a manifest is evidence, while no manifest at
// all is only ignorance.
func Absent(field Field, confidence Confidence, evidence string) Signal {
	return Signal{Field: field, Values: []string{None}, Confidence: confidence, Evidence: evidence}
}

// Detector reads a repository and reports what it finds.
type Detector func(*Repo) []Signal
