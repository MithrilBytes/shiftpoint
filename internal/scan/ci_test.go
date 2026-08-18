package scan

import (
	"slices"
	"testing"
)

type ciCase struct {
	name  string
	files map[string]string
	want  []string
}

var ciCases = []ciCase{
	{
		name:  "a GitHub Actions workflow",
		files: map[string]string{".github/workflows/ci.yml": "name: ci\n"},
		want:  []string{"github-actions"},
	},
	{
		name:  "a GitLab pipeline",
		files: map[string]string{".gitlab-ci.yml": "stages: [test]\n"},
		want:  []string{"gitlab-ci"},
	},
	{
		name:  "a CircleCI configuration",
		files: map[string]string{".circleci/config.yml": "version: 2.1\n"},
		want:  []string{"circleci"},
	},
	{
		name:  "a Jenkinsfile",
		files: map[string]string{"Jenkinsfile": "pipeline {}\n"},
		want:  []string{"jenkins"},
	},
	{
		name:  "two services at once",
		files: map[string]string{".github/workflows/ci.yaml": "name: ci\n", "Jenkinsfile": "pipeline {}\n"},
		want:  []string{"github-actions", "jenkins"},
	},
	{
		// A composite action vendored under the workflow directory carries its
		// own YAML, and that is somebody else's pipeline.
		name:  "a nested action manifest",
		files: map[string]string{".github/workflows/setup/action.yml": "name: setup\n"},
		want:  []string{None},
	},
	{
		name:  "a workflow directory holding something that is not YAML",
		files: map[string]string{".github/workflows/README.md": "how this builds\n"},
		want:  []string{None},
	},
	{
		name:  "no CI at all",
		files: map[string]string{"package.json": "{}"},
		want:  []string{None},
	},
}

func TestDetectCI(t *testing.T) {
	for _, testCase := range ciCases {
		t.Run(testCase.name, func(t *testing.T) {
			signals := DetectCI(build(t, testCase.files))
			if got := signalFor(t, signals, FieldCI).Values; !slices.Equal(got, testCase.want) {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestEveryCIProviderIsCovered(t *testing.T) {
	// Adding a provider without a case above should not be possible.
	for _, provider := range ciProviders {
		covered := slices.ContainsFunc(ciCases, func(testCase ciCase) bool {
			return slices.Contains(testCase.want, provider.value)
		})
		if !covered {
			t.Errorf("%s is in the table but no case reaches it", provider.value)
		}
	}
}
