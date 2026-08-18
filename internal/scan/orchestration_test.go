package scan

import (
	"slices"
	"strings"
	"testing"
)

func TestDetectOrchestrationReadsShapeNotDirectoryName(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  []string
	}{
		{
			name:  "a manifest in deploy/",
			files: map[string]string{"deploy/app.yaml": "apiVersion: apps/v1\nkind: Deployment\n"},
			want:  []string{"kubernetes"},
		},
		{
			name:  "a manifest in k8s/",
			files: map[string]string{"k8s/app.yml": "apiVersion: v1\nkind: Service\n"},
			want:  []string{"kubernetes"},
		},
		{
			name:  "a manifest in kubernetes/",
			files: map[string]string{"kubernetes/cron.yaml": "apiVersion: batch/v1\nkind: CronJob\n"},
			want:  []string{"kubernetes"},
		},
		{
			name:  "a Helm chart and Terraform",
			files: map[string]string{"chart/Chart.yaml": "apiVersion: v2\nname: app\n", "infra/main.tf": `provider "aws" {}`},
			want:  []string{"helm", "terraform"},
		},
		{
			// Both are YAML, and reading either as a cluster billed a small
			// project for one it never asked for.
			name: "a compose file and a workflow are neither",
			files: map[string]string{
				"docker-compose.yml":       "services:\n  web:\n    build: .\n",
				".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
			},
			want: []string{None},
		},
		{
			name:  "a kind nobody schedules",
			files: map[string]string{"config.yaml": "apiVersion: v1\nkind: ConfigMap\ndata: {}\n"},
			want:  []string{None},
		},
		{
			name:  "a kind line with no apiVersion above it",
			files: map[string]string{"notes.yaml": "kind: Deployment\n"},
			want:  []string{None},
		},
		{
			name:  "terraform written as JSON",
			files: map[string]string{"main.tf.json": `{"provider": {"aws": {}}}`},
			want:  []string{"terraform"},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signals := DetectOrchestration(build(t, testCase.files))
			if got := signalFor(t, signals, FieldOrchestration).Values; !slices.Equal(got, testCase.want) {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestEveryKubernetesKindIsRecognised(t *testing.T) {
	// Walking the table is the only thing that stops a deleted line turning a
	// cluster into an empty finding.
	for _, kind := range kubernetesKinds {
		t.Run(kind, func(t *testing.T) {
			repo := build(t, map[string]string{"deploy/object.yaml": "apiVersion: v1\nkind: " + kind + "\n"})
			got := signalFor(t, DetectOrchestration(repo), FieldOrchestration).Values
			if !slices.Contains(got, "kubernetes") {
				t.Errorf("got %v, want kubernetes", got)
			}
		})
	}
}

func TestOrchestrationEvidenceNamesAFile(t *testing.T) {
	repo := build(t, map[string]string{
		"deploy/app.yaml":    "apiVersion: apps/v1\nkind: Deployment\n",
		"deploy/worker.yaml": "apiVersion: apps/v1\nkind: StatefulSet\n",
	})

	evidence := signalFor(t, DetectOrchestration(repo), FieldOrchestration).Evidence
	if !strings.Contains(evidence, "2 Kubernetes manifest(s), including deploy/app.yaml") {
		t.Errorf("evidence does not show its work: %q", evidence)
	}
}
