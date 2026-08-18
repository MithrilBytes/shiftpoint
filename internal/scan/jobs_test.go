package scan

import (
	"slices"
	"strings"
	"testing"
)

func TestJobsFindsAQueueInEveryManifestItReads(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  []string
	}{
		{
			name:  "a Gemfile",
			files: map[string]string{"Gemfile": "gem \"rails\"\ngem \"sidekiq\", \"~> 7.2\"\n"},
			want:  []string{"sidekiq"},
		},
		{
			name:  "a requirements file",
			files: map[string]string{"requirements.txt": "celery==5.4.0\n"},
			want:  []string{"celery"},
		},
		{
			name:  "a package.json",
			files: map[string]string{"package.json": `{"dependencies":{"bullmq":"^5"}}`},
			want:  []string{"bullmq"},
		},
		{
			// Go was the one language this detector did not read, so a Go service
			// with a worker binary consuming a queue looked like it had no
			// background work at all and was quoted a free tier.
			name:  "a go.mod",
			files: map[string]string{"go.mod": "module x\n\ngo 1.22\n\nrequire github.com/hibiken/asynq v0.24.1\n"},
			want:  []string{"asynq"},
		},
		{
			// The gem ships under two names, and both mean the one queue.
			name:  "a gem that ships under two names",
			files: map[string]string{"Gemfile": "gem \"delayed_job_active_record\"\n"},
			want:  []string{"delayed_job"},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signal := DetectJobs(build(t, testCase.files))[0]
			if signal.Field != FieldJobs {
				t.Fatalf("got field %q, want %q", signal.Field, FieldJobs)
			}
			if !slices.Equal(signal.Values, testCase.want) {
				t.Errorf("got %v, want %v", signal.Values, testCase.want)
			}
			if signal.Confidence != High {
				t.Errorf("got %v, want high", signal.Confidence)
			}
			if signal.Evidence == "" {
				t.Error("a finding with no evidence behind it")
			}
		})
	}
}

func TestJobsSortsQueuesAndKeepsTheEvidenceForEach(t *testing.T) {
	repo := build(t, map[string]string{
		"Gemfile":          "gem \"sidekiq\"\n",
		"requirements.txt": "celery==5.4.0\n",
	})

	signal := DetectJobs(repo)[0]
	if !slices.Equal(signal.Values, []string{"celery", "sidekiq"}) {
		t.Fatalf("got %v, want [celery sidekiq]", signal.Values)
	}
	for _, want := range []string{"a python manifest requires celery", "Gemfile requires sidekiq"} {
		if !strings.Contains(signal.Evidence, want) {
			t.Errorf("evidence is missing %q: %q", want, signal.Evidence)
		}
	}
}

func TestJobsAbsenceIsRatedByWhatThereWasToRead(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  Confidence
	}{
		{
			name:  "a manifest with no queue library",
			files: map[string]string{"package.json": `{"dependencies":{"express":"^4"}}`},
			want:  Medium,
		},
		{
			name:  "nothing to read at all",
			files: map[string]string{"notes.txt": "nothing to see"},
			want:  Low,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signal := DetectJobs(build(t, testCase.files))[0]
			if !slices.Equal(signal.Values, []string{None}) {
				t.Fatalf("got %v, want [none]", signal.Values)
			}
			if signal.Confidence != testCase.want {
				t.Errorf("got %v, want %v", signal.Confidence, testCase.want)
			}
			if signal.Evidence == "" {
				t.Error("an absence with no evidence behind it")
			}
		})
	}
}

func TestQueueByDependencyReportsOnlyNamesItAlsoRecognizes(t *testing.T) {
	// Every queue this detector can report has to be a name it would recognize
	// if it read it back, or the vocabulary the rules match on and the
	// vocabulary this table produces have drifted apart.
	for name, queue := range QueueByDependency {
		if name != strings.ToLower(name) {
			t.Errorf("dependency %q is not lowercase, so it can never match", name)
		}
		if _, ok := QueueByDependency[queue]; !ok {
			t.Errorf("%q reports queue %q, which is not itself a name in the table", name, queue)
		}
	}
}
