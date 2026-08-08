import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";
import { declaredDependencies } from "./manifest.js";

export const PROCESSOR_BY_DEPENDENCY = new Map<string, string>([
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

// Tools a business buys and a weekend project does not.
const BUSINESS_TOOLING = new Set([
  "intercom",
  "@intercom/messenger-js-sdk",
  "zendesk",
  "@hubspot/api-client",
  "chargebee",
  "recurly",
  "@segment/analytics-node",
  "analytics-node",
]);

// Routes that only exist when someone is being sold something.
const SELLING_ROUTE = /(^|\/)(pricing|checkout|billing|subscribe)(\/|\.[a-z]+$)/i;

/**
 * Whether this repository is a commercial project.
 *
 * This is not about load. It decides eligibility: the free tiers most small web
 * apps land on, Vercel's Hobby plan among them, are licensed for personal and
 * non commercial use only. A commercial project on one of those plans has a
 * bill coming on someone else's schedule.
 *
 * This detector answers "yes" or "unclear" and never "no". Nothing in a
 * repository can prove an absence of commercial intent: plenty of businesses
 * invoice outside the product and ship no payment code at all. Saying "unclear"
 * lets the rules state the licensing condition rather than assume it away.
 */
export function detectCommercial(repo: Repo): Signal[] {
  const processors = new Map<string, string>();
  const other: string[] = [];

  const dependencies = declaredDependencies(repo);

  for (const name of dependencies) {
    const processor = PROCESSOR_BY_DEPENDENCY.get(name);
    if (processor !== undefined && !processors.has(processor)) {
      processors.set(processor, `a manifest depends on ${name}`);
    }
    if (BUSINESS_TOOLING.has(name)) {
      other.push(`a manifest depends on ${name}`);
    }
  }

  const selling = repo.matching(SELLING_ROUTE);
  if (selling.length > 0) other.push(`a ${selling[0]} route`);

  const reasons = [...processors.values(), ...other];
  if (reasons.length > 0) {
    return [
      {
        kind: "commercial",
        values: ["yes"],
        confidence: "high",
        evidence: reasons.join("; "),
      },
    ];
  }

  return [
    {
      kind: "commercial",
      values: ["unclear"],
      confidence: "low",
      evidence: "nothing here shows money changing hands, which is not the same as showing it does not",
    },
  ];
}
