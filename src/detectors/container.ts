import type { Repo } from "../repo.js";
import type { Signal } from "../types.js";
import { composeFiles, composeServices } from "./manifest.js";

const DOCKERFILE = /(^|\/)Dockerfile(\.[^/]+)?$/;

/**
 * How the application is packaged, plus how many services it is actually made
 * of. The service count feeds demand: shipping two application services is
 * something the repository does, not something it merely configures.
 */
export function detectContainer(repo: Repo): Signal[] {
  const values: string[] = [];
  const evidence: string[] = [];

  const dockerfiles = repo.matching(DOCKERFILE);
  if (dockerfiles.length > 0) {
    values.push("dockerfile");
    evidence.push(dockerfiles.join(", "));
  }

  const compose = composeFiles(repo);
  if (compose.length > 0) {
    values.push("compose");
    evidence.push(compose.join(", "));
  }

  const container: Signal = {
    kind: "container",
    values: values.length > 0 ? values : ["none"],
    confidence: "high",
    evidence: values.length > 0 ? `found ${evidence.join(", ")}` : "no Dockerfile or compose file",
  };

  const services = composeServices(repo);
  if (services === undefined) {
    return [container];
  }

  return [
    container,
    {
      kind: "app_services",
      values: [],
      confidence: "high",
      metric: services.app.length,
      evidence:
        services.app.length > 0
          ? `compose runs ${services.app.join(", ")} alongside ${services.infrastructure.length} backing service(s)`
          : "compose declares no application service of its own",
    },
  ];
}
