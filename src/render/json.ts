import type { Verdict } from "../types.js";

/**
 * The verdict for machines. The four contract fields come first and in order,
 * the same as every other renderer.
 */
export function renderJson(verdict: Verdict): string {
  return (
    JSON.stringify(
      {
        schema: 1,
        stage: verdict.stage,
        headroom: verdict.headroom,
        tripwire: verdict.tripwire,
        flags: verdict.flags,
        confidence: verdict.confidence,
        confidenceNote: verdict.confidenceNote,
        doNothingToday: verdict.doNothingToday,
      },
      null,
      2,
    ) + "\n"
  );
}
