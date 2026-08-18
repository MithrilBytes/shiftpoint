package scan

import (
	"sort"
	"strings"
)

// QueueByDependency maps the queue libraries this tool recognizes onto the
// engine's vocabulary. A library and the queue it is are usually spelled the
// same; where a gem ships under two names, both point at the one queue.
var QueueByDependency = map[string]string{
	"sidekiq":                   "sidekiq",
	"resque":                    "resque",
	"delayed_job":               "delayed_job",
	"delayed_job_active_record": "delayed_job",
	"good_job":                  "good_job",
	"solid_queue":               "solid_queue",
	"celery":                    "celery",
	"rq":                        "rq",
	"dramatiq":                  "dramatiq",
	"huey":                      "huey",
	"bullmq":                    "bullmq",
	"bull":                      "bull",
	"agenda":                    "agenda",

	// Go. Matched on the normalised segments GoDependencies produces, the same
	// way the framework detector matches chi and gin.
	"asynq":     "asynq",
	"machinery": "machinery",
}

// DetectJobs reports background work. A queue library in a manifest means the
// application already does work outside the request cycle, which is the
// clearest demand signal a repository gives off: it needs somewhere for that
// work to run.
func DetectJobs(repo *Repo) []Signal {
	evidence := make(map[string]string)
	var order []string

	note := func(name, phrase string) {
		queue := QueueByDependency[name]
		if queue == "" || evidence[queue] != "" {
			return
		}
		evidence[queue] = phrase + " " + name
		order = append(order, queue)
	}

	// Read in sorted order rather than the order a manifest lists them, because
	// Go map iteration is random and the evidence sentence must not be.
	for _, name := range sortedNames(NodeDependencies(repo)) {
		note(name, "package.json depends on")
	}
	for _, name := range sortedNames(PythonDependencies(repo)) {
		note(name, "a python manifest requires")
	}
	for _, name := range sortedNames(RubyDependencies(repo)) {
		note(name, "Gemfile requires")
	}
	// Go was the one language this detector did not read, so a Go service with a
	// worker binary consuming a queue looked like it had no background work at
	// all and was quoted a free tier.
	for _, name := range sortedNames(GoDependencies(repo)) {
		note(name, "go.mod requires")
	}

	if len(order) > 0 {
		sentences := make([]string, 0, len(order))
		for _, queue := range order {
			sentences = append(sentences, evidence[queue])
		}
		queues := append([]string(nil), order...)
		sort.Strings(queues)
		return []Signal{Found(FieldJobs, High, strings.Join(sentences, "; "), queues...)}
	}

	if manifests := ManifestFiles(repo); len(manifests) > 0 {
		return []Signal{Absent(FieldJobs, Medium, "no queue library in "+strings.Join(manifests, ", "))}
	}

	return []Signal{Absent(FieldJobs, Low, "no dependency manifest to read, so absence of background work is unproven")}
}
