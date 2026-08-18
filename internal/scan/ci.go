package scan

import (
	"path"
	"strings"
)

// ciProvider is one continuous integration service and the file that gives it
// away.
type ciProvider struct {
	value string
	label string
	match func(file string) bool
}

// ciProviders are the services this tool can name, in report order.
var ciProviders = []ciProvider{
	{
		value: "github-actions",
		label: ".github/workflows",
		// One level down and no further. A composite action vendored under a
		// workflow directory carries its own YAML, and that is somebody else's
		// pipeline rather than this repository's.
		match: func(file string) bool {
			name, ok := strings.CutPrefix(file, ".github/workflows/")
			return ok && !strings.Contains(name, "/") && isYAMLName(name)
		},
	},
	{
		value: "gitlab-ci",
		label: ".gitlab-ci.yml",
		match: func(file string) bool { return file == ".gitlab-ci.yml" || file == ".gitlab-ci.yaml" },
	},
	{
		value: "circleci",
		label: ".circleci/config.yml",
		match: func(file string) bool { return file == ".circleci/config.yml" || file == ".circleci/config.yaml" },
	},
	{
		value: "jenkins",
		label: "Jenkinsfile",
		match: func(file string) bool { return path.Base(file) == "Jenkinsfile" },
	},
}

func isYAMLName(name string) bool {
	return strings.HasSuffix(name, ".yml") || strings.HasSuffix(name, ".yaml")
}

// DetectCI reports which continuous integration service, if any, this
// repository is wired to. No shipped rule matches on this yet. It is in the
// profile because rules are data: starting to use it is a change to rules/,
// not to this file.
func DetectCI(repo *Repo) []Signal {
	var values, evidence []string

	for _, provider := range ciProviders {
		if len(repo.Matching(provider.match)) > 0 {
			values = append(values, provider.value)
			evidence = append(evidence, provider.label)
		}
	}

	if len(values) == 0 {
		return []Signal{Absent(FieldCI, High, "no CI configuration")}
	}
	return []Signal{Found(FieldCI, High, "found "+strings.Join(evidence, ", "), values...)}
}
