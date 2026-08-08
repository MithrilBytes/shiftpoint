import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";

/**
 * Whether the scan actually saw the whole repository.
 *
 * A file that was never walked, and a file that was too large to read, both
 * read exactly like a file that does not exist. Every other detector reports
 * absence as evidence, so without this the tool would quietly treat its own
 * blind spots as findings about the code.
 *
 * This runs last, after every other detector, because the list of files a read
 * was refused for is only complete once the reads have happened.
 */
export function detectCoverage(repo: Repo): Signal[] {
  const refused = repo.unreadable();

  if (!repo.truncated && refused.length === 0) {
    return [
      {
        kind: "scan",
        values: ["complete"],
        confidence: "high",
        evidence: `read all ${repo.files.length} files`,
      },
    ];
  }

  const reasons: string[] = [];
  if (repo.truncated) reasons.push(`stopped after ${repo.files.length} files`);
  if (refused.length > 0) reasons.push(`${refused.length} file(s) too large to read, including ${refused[0]}`);

  return [
    {
      kind: "scan",
      values: ["partial"],
      confidence: "high",
      evidence: reasons.join("; "),
    },
  ];
}
