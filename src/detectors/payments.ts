import type { Repo } from "../repo.js";
import type { Signal } from "../types.js";
import { manifestFiles, nodeDependencies, pythonDependencies, rubyDependencies } from "./manifest.js";

const PROCESSOR_BY_DEPENDENCY = new Map<string, string>([
  ["stripe", "stripe"],
  ["@stripe/stripe-js", "stripe"],
  ["paddle-sdk", "paddle"],
  ["@paddle/paddle-node-sdk", "paddle"],
  ["lemonsqueezy.ts", "lemonsqueezy"],
  ["@lemonsqueezy/lemonsqueezy.js", "lemonsqueezy"],
  ["braintree", "braintree"],
  ["paypalrestsdk", "paypal"],
  ["@paypal/checkout-server-sdk", "paypal"],
]);

/**
 * Whether this repository takes money.
 *
 * This is not about load. It is about eligibility: the most common free tier a
 * small web app lands on, Vercel's Hobby plan, is licensed for personal and
 * non commercial use only. A payment processor in the manifest means the free
 * tier the owner is probably sitting on does not cover what they are doing,
 * which is a bill they will meet on someone else's schedule rather than their
 * own.
 */
export function detectPayments(repo: Repo): Signal[] {
  const found = new Map<string, string>();

  const note = (name: string, evidence: string): void => {
    const processor = PROCESSOR_BY_DEPENDENCY.get(name);
    if (processor !== undefined && !found.has(processor)) found.set(processor, evidence);
  };

  for (const name of nodeDependencies(repo)) note(name, `package.json depends on ${name}`);
  for (const name of pythonDependencies(repo)) note(name, `a python manifest requires ${name}`);
  for (const name of rubyDependencies(repo)) note(name, `Gemfile requires ${name}`);

  if (found.size > 0) {
    return [
      {
        kind: "payments",
        values: [...found.keys()].sort(),
        confidence: "high",
        evidence: [...found.values()].join("; "),
      },
    ];
  }

  const manifests = manifestFiles(repo);
  return [
    {
      kind: "payments",
      values: ["none"],
      confidence: manifests.length > 0 ? "medium" : "low",
      evidence:
        manifests.length > 0
          ? `no payment processor in ${manifests.join(", ")}`
          : "no dependency manifest to read",
    },
  ];
}
