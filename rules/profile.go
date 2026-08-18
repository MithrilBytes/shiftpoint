package rules

import (
	"fmt"
	"strings"

	"github.com/MithrilBytes/shiftpoint/internal/scan"
)

// BuildProfile turns raw signals into the shape rules match against.
//
// Two fields are derived here rather than detected. Assets applies the byte
// threshold, which lives in the data so detectors stay free of numbers. Demand
// answers the question the whole tool turns on: does this repository show signs
// of needing more than one small machine?
//
// Demand comes only from what the application does. What the deployment
// configuration asks for is never demand, because a replica count is an
// intention and this tool reads evidence. That distinction is the only reason
// it can tell somebody their Kubernetes setup is unearned.
func BuildProfile(signals []scan.Signal, thresholds Thresholds) Profile {
	profile := Profile{
		Fields:     map[string][]string{},
		Confidence: map[string]Confidence{},
		Evidence:   map[string]string{},
	}

	var assetBytes, appServices int64
	for _, signal := range signals {
		switch signal.Field {
		case scan.FieldAssetBytes:
			assetBytes = int64(signal.Metric)
		case scan.FieldAppServices:
			appServices = int64(signal.Metric)
		}
		if len(signal.Values) == 0 {
			continue
		}
		name := string(signal.Field)
		profile.Fields[name] = signal.Values
		profile.Confidence[name] = confidenceOf(signal.Confidence)
		profile.Evidence[name] = signal.Evidence
	}

	heavy := assetBytes >= thresholds.StaticHeavyBytes
	profile.set(scan.FieldAssets, weight(heavy), High,
		fmt.Sprintf("%d bytes of checked in assets", assetBytes))

	jobs := profile.Fields[string(scan.FieldJobs)]
	var reasons []string
	if len(jobs) > 0 && !contains(jobs, scan.None) {
		reasons = append(reasons, "background work ("+strings.Join(jobs, ", ")+")")
	}
	if appServices > 1 {
		reasons = append(reasons, fmt.Sprintf("%d application services", appServices))
	}
	if heavy {
		reasons = append(reasons, "heavy static assets")
	}

	if len(reasons) > 0 {
		profile.set(scan.FieldDemand, "present", High, "demand from "+strings.Join(reasons, ", "))
	} else {
		profile.set(scan.FieldDemand, scan.None, High,
			"no background work, no second application service, no heavy assets")
	}

	return profile
}

func (p Profile) set(field scan.Field, value string, confidence Confidence, evidence string) {
	name := string(field)
	p.Fields[name] = []string{value}
	p.Confidence[name] = confidence
	p.Evidence[name] = evidence
}

func weight(heavy bool) string {
	if heavy {
		return "heavy"
	}
	return "light"
}

func confidenceOf(level scan.Confidence) Confidence {
	switch level {
	case scan.High:
		return High
	case scan.Medium:
		return Medium
	default:
		return Low
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
