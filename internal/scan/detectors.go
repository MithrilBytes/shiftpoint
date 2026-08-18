package scan

// Detectors is every detector, in the order they run.
//
// The order is part of the contract rather than a matter of taste. Coverage is
// last because it reports which files could not be read, and that is only
// known once every other detector has tried to read them. Everything before it
// is independent: no detector reads another's signals, so the rest of the list
// is read order, not dependency order.
var Detectors = []Detector{
	DetectFramework,
	DetectShape,
	DetectApps,
	DetectDatabase,
	DetectContainer,
	DetectOrchestration,
	DetectJobs,
	DetectServerless,
	DetectCommercial,
	DetectAssets,
	DetectCI,
	DetectCoverage,
}

// RunAll applies every detector to the repository and returns their signals in
// detector order. It never fails: a repository is untrusted input, and a file
// that cannot be read is a finding rather than an error.
func RunAll(repo *Repo) []Signal {
	signals := make([]Signal, 0, len(Detectors))
	for _, detect := range Detectors {
		signals = append(signals, detect(repo)...)
	}
	return signals
}
