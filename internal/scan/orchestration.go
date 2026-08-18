package scan

import (
	"fmt"
	"regexp"
	"strings"
)

// kubernetesKinds are the object kinds a Kubernetes manifest declares. A
// document is recognised by its own shape rather than by the directory holding
// it, which is what lets k8s/, kubernetes/ and deploy/ all register, and what
// stops a compose file or a CI workflow being read as one.
var kubernetesKinds = []string{
	"Deployment",
	"StatefulSet",
	"DaemonSet",
	"ReplicaSet",
	"Service",
	"Ingress",
	"Job",
	"CronJob",
	"HorizontalPodAutoscaler",
	"PodDisruptionBudget",
	"Namespace",
}

var (
	apiVersionPattern     = regexp.MustCompile(`(?m)^apiVersion:`)
	kubernetesKindPattern = regexp.MustCompile(`(?m)^kind:\s*(` + strings.Join(kubernetesKinds, "|") + `)\b`)
)

// DetectOrchestration reports the orchestration and infrastructure as code
// present in the repository, found by shape rather than by directory name so
// k8s/, kubernetes/, deploy/, and a Helm chart all register.
//
// This detector only reports what is present. Whether any of it is warranted
// is a question for the rules, which weigh it against demand.
func DetectOrchestration(repo *Repo) []Signal {
	var values, evidence []string

	var manifests []string
	for _, file := range repo.WithExtension(".yaml", ".yml") {
		// Both markers are required. A compose file and a workflow are YAML
		// too, and either would otherwise be counted as a cluster this
		// repository asks for.
		text := repo.Read(file)
		if apiVersionPattern.MatchString(text) && kubernetesKindPattern.MatchString(text) {
			manifests = append(manifests, file)
		}
	}
	if len(manifests) > 0 {
		values = append(values, "kubernetes")
		evidence = append(evidence, fmt.Sprintf("%d Kubernetes manifest(s), including %s", len(manifests), manifests[0]))
	}

	if charts := repo.Named("Chart.yaml", "Chart.yml"); len(charts) > 0 {
		values = append(values, "helm")
		evidence = append(evidence, "Helm chart at "+charts[0])
	}

	if terraform := repo.WithExtension(".tf", ".tf.json"); len(terraform) > 0 {
		values = append(values, "terraform")
		evidence = append(evidence, fmt.Sprintf("%d Terraform file(s), including %s", len(terraform), terraform[0]))
	}

	if len(values) == 0 {
		return []Signal{Absent(FieldOrchestration, High, "no Kubernetes, Helm, or Terraform files")}
	}
	return []Signal{Found(FieldOrchestration, High, "found "+strings.Join(evidence, "; "), values...)}
}
