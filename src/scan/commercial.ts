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

/**
 * Payment and storefront platforms named in the environment.
 *
 * Plenty of applications call one of these over plain HTTP and carry no SDK at
 * all, so the dependency list shows nothing. The credential in .env says the
 * same thing the dependency would: this repository is wired to somebody's
 * merchant account, and a plan licensed for personal use does not cover that.
 */
const MERCHANT_CREDENTIAL = [
  "stripe",
  "shopify",
  "paddle",
  "lemonsqueezy",
  "braintree",
  "paypal",
  "adyen",
  "chargebee",
  "recurly",
  "mollie",
  "razorpay",
];

const ENV_FILE = /(^|\/)\.env(\.example|\.sample|\.template)?$/;
const ENV_VARIABLE = /^\s*(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=/gm;

// Routes that only exist when someone is being sold something.
//
// Anchored to the directories frameworks actually serve routes from. Matched
// against any path, a microservice named services/billing/ or a docs/pricing.md
// was enough to call an internal tool a business and charge it $20/mo.
const SELLING_ROUTE =
  /(^|\/)(app|pages|src\/pages|src\/routes|routes|views|templates)\/[^/]*(pricing|checkout|subscribe)(\/|\.[a-z]+$)/i;

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

  for (const file of repo.matching(ENV_FILE)) {
    const text = repo.read(file) ?? "";
    for (const match of text.matchAll(ENV_VARIABLE)) {
      const name = (match[1] ?? "").toLowerCase().replace(/_/g, "");
      const platform = MERCHANT_CREDENTIAL.find((vendor) => name.includes(vendor));
      if (platform !== undefined && !processors.has(platform)) {
        processors.set(platform, `${file} sets ${match[1]}`);
      }
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
