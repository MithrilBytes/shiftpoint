import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";

const PROVIDERS: Array<{ pattern: RegExp; value: string; label: string }> = [
  { pattern: /^\.github\/workflows\/[^/]+\.ya?ml$/, value: "github-actions", label: ".github/workflows" },
  { pattern: /^\.gitlab-ci\.ya?ml$/, value: "gitlab-ci", label: ".gitlab-ci.yml" },
  { pattern: /^\.circleci\/config\.ya?ml$/, value: "circleci", label: ".circleci/config.yml" },
  { pattern: /(^|\/)Jenkinsfile$/, value: "jenkins", label: "Jenkinsfile" },
];

/**
 * Which continuous integration service, if any, this repository is wired to.
 * No shipped rule matches on this yet. It is in the profile because rules are
 * data: starting to use it is a change to rules/, not to this file.
 */
export function detectCi(repo: Repo): Signal[] {
  const values: string[] = [];
  const evidence: string[] = [];

  for (const provider of PROVIDERS) {
    if (repo.matching(provider.pattern).length > 0) {
      values.push(provider.value);
      evidence.push(provider.label);
    }
  }

  return [
    {
      kind: "ci",
      values: values.length > 0 ? values : ["none"],
      confidence: "high",
      evidence: values.length > 0 ? `found ${evidence.join(", ")}` : "no CI configuration",
    },
  ];
}
