import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { composeFiles, composeServices } from "./manifest.js";

/**
 * A build that produces an image. Shared with the shape detector, which reads
 * it as an artefact this repository makes rather than a thing it runs.
 */
export const DOCKERFILE = /(^|\/)Dockerfile(\.[^/]+)?$/;
const PROXY_CONFIG = /(^|\/)([^/]+\.conf|Caddyfile(\.[^/]+)?)$/;
const PROXY_TARGET = /(?:proxy_pass|reverse_proxy)\s+(?:https?:\/\/)?([^\s;{]+)/g;

/**
 * The distinct backends a checked in reverse proxy routes to.
 *
 * A proxy naming two backends is two processes of this repository's own code
 * running side by side, which is the same fact a compose file states when it
 * declares two application services. It is read for the same reason and with
 * the same care: what is running, never how many copies of it somebody would
 * like to start.
 */
function proxiedBackends(repo: Repo): string[] {
  const targets = new Set<string>();
  for (const file of repo.matching(PROXY_CONFIG)) {
    for (const match of (repo.read(file) ?? "").matchAll(PROXY_TARGET)) {
      const target = (match[1] ?? "").replace(/\/+$/, "").toLowerCase();
      if (target !== "") targets.add(target);
    }
  }
  return [...targets].sort();
}
const EXPOSE = /^\s*EXPOSE\s+(\d+)/im;

/**
 * A port the repository's own image declares it listens on, or undefined.
 *
 * EXPOSE is the author stating, in the file that builds this code into an
 * image, that the process inside it accepts connections. Nobody writes it for a
 * command line tool or a batch job. It is read only from a Dockerfile and never
 * from a compose file, because a Dockerfile builds this repository's source
 * while a compose file may be pinning somebody else's image.
 */
export function exposedPort(repo: Repo): string | undefined {
  for (const file of repo.matching(DOCKERFILE)) {
    const match = EXPOSE.exec(repo.read(file) ?? "");
    if (match) return `${file} exposes port ${match[1]}, so the image is built to be listened to`;
  }
  return undefined;
}

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
  const backends = proxiedBackends(repo);
  const composed = services?.app.length ?? 0;

  // One backend is one application, which is what a proxy in front of a single
  // service says and is no news. Below two it adds nothing compose has not
  // already said.
  if (services === undefined && backends.length < 2) {
    return [container];
  }

  const fromCompose =
    composed > 0
      ? `compose runs ${services?.app.join(", ")} alongside ${services?.infrastructure.length} backing service(s)`
      : "compose declares no application service of its own";

  return [
    container,
    {
      kind: "app_services",
      values: [],
      confidence: "high",
      metric: Math.max(composed, backends.length),
      evidence:
        backends.length > composed
          ? `a proxy configuration routes to ${backends.length} separate backends: ${backends.join(", ")}`
          : fromCompose,
    },
  ];
}
