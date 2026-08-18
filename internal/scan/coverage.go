package scan

import (
	"fmt"
	"strings"
)

// DetectCoverage reports whether the scan actually saw the whole repository.
//
// A file that was never walked, and a file that was too large to read, both
// read exactly like a file that does not exist. Every other detector reports
// absence as evidence, so without this the tool would quietly treat its own
// blind spots as findings about the code.
//
// This runs last, after every other detector, because the list of files a read
// was refused for is only complete once the reads have happened.
func DetectCoverage(repo *Repo) []Signal {
	refused := repo.Unread()

	if !repo.Truncated() && len(refused) == 0 {
		return []Signal{Found(FieldScan, High, fmt.Sprintf("read all %d files", len(repo.Files)), "complete")}
	}

	var reasons []string
	if repo.Truncated() {
		reasons = append(reasons, fmt.Sprintf("stopped after %d files", len(repo.Files)))
	}
	if len(refused) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d file(s) too large to read, including %s", len(refused), refused[0]))
	}

	return []Signal{Found(FieldScan, High, strings.Join(reasons, "; "), "partial")}
}
