import type { Verdict } from "../types.js";

/** The verdict as INFRA.md, written into the repository that was analyzed. */
export function renderMarkdown(verdict: Verdict): string {
  const sections = [
    "# Infrastructure",
    "What this repository needs today, based only on the files in it.",
    `**Stage:** ${verdict.stage}`,
    `**Headroom:** ${verdict.headroom}`,
    `**Tripwire:** ${verdict.tripwire}`,
    verdict.flags.length > 0
      ? "**Flags:**\n\n" + verdict.flags.map((flag) => `- ${flag}`).join("\n")
      : "**Flags:** None.",
    verdict.confidenceNote,
  ];

  if (verdict.doNothingToday) {
    sections.push("Do nothing today.");
  }

  sections.push("Written by shiftpoint. Run `shiftpoint --write` to update.");

  return sections.join("\n\n") + "\n";
}
