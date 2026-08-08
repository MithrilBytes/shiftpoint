import { describe, expect, it } from "vitest";
import { renderJson } from "../src/render/json.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { renderTerminal } from "../src/render/terminal.js";
import type { Verdict } from "../src/types.js";

const flagged: Verdict = {
  stage: "Single small VPS is sufficient (est. $12-20/mo)",
  headroom: "This stack typically serves ~5k daily users at this tier",
  tripwire: "If you add background jobs or exceed ~50GB/mo bandwidth, revisit. Next tier is ~$40/mo.",
  flags: [
    "Found Kubernetes manifests. Adds ~$70/mo and ops burden with no signal you need it yet.",
    "Found a Helm chart. It manages releases across a fleet of services, and this repository holds one.",
  ],
  confidence: "medium",
  confidenceNote: "Confidence: medium. Some of this is inferred from what the repository does not contain.",
  doNothingToday: false,
};

const quiet: Verdict = {
  stage: "Static hosting is sufficient (est. $0-5/mo)",
  headroom: "This stack typically serves ~25k daily visitors at this tier",
  tripwire: "If you add a login, revisit.",
  flags: [],
  confidence: "high",
  confidenceNote: "Confidence: high. The files in this repository point clearly at this answer.",
  doNothingToday: true,
};

describe("terminal", () => {
  it("prints the four fields in order under aligned labels", () => {
    const lines = renderTerminal(flagged).split("\n");
    expect(lines[0]).toBe("Stage:    Single small VPS is sufficient (est. $12-20/mo)");
    expect(lines[1]).toBe("Headroom: This stack typically serves ~5k daily users at this tier");
    expect(lines[2]).toBe("Tripwire: If you add background jobs or exceed ~50GB/mo bandwidth,");
    expect(lines[3]).toBe("          revisit. Next tier is ~$40/mo.");
    expect(lines[4]).toBe("Flags:    Found Kubernetes manifests. Adds ~$70/mo and ops burden with");
    expect(lines[5]).toBe("          no signal you need it yet.");
  });

  it("gives each flag its own wrapped paragraph", () => {
    const lines = renderTerminal(flagged).split("\n");
    expect(lines[6]).toBe("          Found a Helm chart. It manages releases across a fleet of");
    expect(lines[7]).toBe("          services, and this repository holds one.");
  });

  it("never runs past 70 columns", () => {
    for (const line of renderTerminal(flagged).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });

  it("says None when nothing is over provisioned, and closes with the verdict", () => {
    const output = renderTerminal(quiet);
    expect(output).toContain("Flags:    None.");
    expect(output.endsWith("\nDo nothing today.\n")).toBe(true);
  });

  it("leaves the closing sentence off when there is something to remove", () => {
    expect(renderTerminal(flagged)).not.toContain("Do nothing today.");
  });

  it("keeps internal metrics out of what a founder reads", () => {
    const output = renderTerminal(flagged) + renderTerminal(quiet);
    expect(output).not.toMatch(/\b(CPU|RPS|p95|p99|IOPS|latency|throughput)\b/i);
  });
});

describe("markdown", () => {
  it("lists flags as bullets and ends with a newline", () => {
    const output = renderMarkdown(flagged);
    expect(output).toContain("**Flags:**\n\n- Found Kubernetes manifests.");
    expect(output.endsWith("\n")).toBe(true);
    expect(output).not.toContain("Do nothing today.");
  });

  it("keeps the four fields in contract order", () => {
    const output = renderMarkdown(quiet);
    expect(output.indexOf("**Stage:**")).toBeLessThan(output.indexOf("**Headroom:**"));
    expect(output.indexOf("**Headroom:**")).toBeLessThan(output.indexOf("**Tripwire:**"));
    expect(output.indexOf("**Tripwire:**")).toBeLessThan(output.indexOf("**Flags:**"));
    expect(output).toContain("**Flags:** None.");
    expect(output).toContain("Do nothing today.");
  });
});

describe("json", () => {
  it("emits the four fields first and in order", () => {
    const parsed = JSON.parse(renderJson(flagged)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "schema",
      "stage",
      "headroom",
      "tripwire",
      "flags",
      "confidence",
      "confidenceNote",
      "doNothingToday",
    ]);
    expect(parsed["flags"]).toHaveLength(2);
  });
});

describe("every renderer", () => {
  it("reads the same verdict and says the same thing about it", () => {
    const json = JSON.parse(renderJson(quiet)) as Record<string, unknown>;
    for (const output of [renderTerminal(quiet), renderMarkdown(quiet)]) {
      expect(output).toContain(quiet.stage);
      expect(output).toContain(quiet.headroom);
      expect(output).toContain(quiet.tripwire);
      expect(output).toContain("Do nothing today.");
    }
    expect(json["stage"]).toBe(quiet.stage);
    expect(json["doNothingToday"]).toBe(true);
  });
});
