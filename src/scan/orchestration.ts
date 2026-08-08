import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";

const YAML_FILE = /\.ya?ml$/;
const CHART_FILE = /(^|\/)Chart\.ya?ml$/;
const TERRAFORM_FILE = /\.tf(\.json)?$/;

const API_VERSION = /^apiVersion:/m;
const KUBERNETES_KIND =
  /^kind:\s*(Deployment|StatefulSet|DaemonSet|ReplicaSet|Service|Ingress|Job|CronJob|HorizontalPodAutoscaler|PodDisruptionBudget|Namespace)\b/m;

/**
 * Orchestration and infrastructure as code, found by shape rather than by
 * directory name so `k8s/`, `kubernetes/`, `deploy/`, and a Helm chart all
 * register.
 *
 * This detector only reports what is present. Whether any of it is warranted
 * is a question for the rules, which weigh it against demand.
 */
export function detectOrchestration(repo: Repo): Signal[] {
  const values: string[] = [];
  const evidence: string[] = [];

  const manifests = repo
    .matching(YAML_FILE)
    .filter((file) => {
      const text = repo.read(file);
      return text !== undefined && API_VERSION.test(text) && KUBERNETES_KIND.test(text);
    });

  if (manifests.length > 0) {
    values.push("kubernetes");
    evidence.push(`${manifests.length} Kubernetes manifest(s), including ${manifests[0]}`);
  }

  const charts = repo.matching(CHART_FILE);
  if (charts.length > 0) {
    values.push("helm");
    evidence.push(`Helm chart at ${charts[0]}`);
  }

  const terraform = repo.matching(TERRAFORM_FILE);
  if (terraform.length > 0) {
    values.push("terraform");
    evidence.push(`${terraform.length} Terraform file(s), including ${terraform[0]}`);
  }

  return [
    {
      kind: "orchestration",
      values: values.length > 0 ? values : ["none"],
      confidence: "high",
      evidence:
        values.length > 0 ? `found ${evidence.join("; ")}` : "no Kubernetes, Helm, or Terraform files",
    },
  ];
}
