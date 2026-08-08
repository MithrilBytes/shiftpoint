import type { Verdict } from "../types.js";

// Narrow enough to read in a split terminal and to paste into a message.
const WIDTH = 70;
const LABEL_WIDTH = 10;

/** The verdict as a founder reads it in their terminal. */
export function renderTerminal(verdict: Verdict): string {
  const lines = [
    block("Stage", [verdict.stage]),
    block("Headroom", [verdict.headroom]),
    block("Tripwire", [verdict.tripwire]),
    block("Flags", verdict.flags.length > 0 ? verdict.flags : ["None."]),
    "",
    wrap(verdict.confidenceNote, WIDTH).join("\n"),
  ];

  if (verdict.doNothingToday) {
    lines.push("", "Do nothing today.");
  }

  return lines.join("\n") + "\n";
}

function block(label: string, paragraphs: string[]): string {
  const head = (label + ":").padEnd(LABEL_WIDTH);
  const indent = " ".repeat(LABEL_WIDTH);
  const body = paragraphs.flatMap((paragraph) => wrap(paragraph, WIDTH - LABEL_WIDTH));
  return body.map((line, index) => (index === 0 ? head : indent) + line).join("\n");
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((word) => word !== "")) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
