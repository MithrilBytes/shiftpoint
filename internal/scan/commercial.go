package scan

import (
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// ProcessorByDependency maps a dependency name to the payment processor it
// names. Exported so a test can walk it: every entry has to be reachable, or a
// deleted line silently turns a business back into a hobby project.
var ProcessorByDependency = map[string]string{
	"stripe":                        "stripe",
	"@stripe/stripe-js":             "stripe",
	"paddle-sdk":                    "paddle",
	"@paddle/paddle-node-sdk":       "paddle",
	"lemonsqueezy.ts":               "lemonsqueezy",
	"@lemonsqueezy/lemonsqueezy.js": "lemonsqueezy",
	"braintree":                     "braintree",
	"paypalrestsdk":                 "paypal",
	"@paypal/checkout-server-sdk":   "paypal",
}

// businessTooling are tools a business buys and a weekend project does not.
var businessTooling = map[string]bool{
	"intercom":                   true,
	"@intercom/messenger-js-sdk": true,
	"zendesk":                    true,
	"@hubspot/api-client":        true,
	"chargebee":                  true,
	"recurly":                    true,
	"@segment/analytics-node":    true,
	"analytics-node":             true,
}

// merchantCredentials are payment and storefront platforms named in the
// environment. Ordered, because the first vendor a variable name contains is
// the one it is credited to.
//
// Plenty of applications call one of these over plain HTTP and carry no SDK at
// all, so the dependency list shows nothing. The credential in .env says the
// same thing the dependency would: this repository is wired to somebody's
// merchant account, and a plan licensed for personal use does not cover that.
var merchantCredentials = []string{
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
}

var envVariablePattern = regexp.MustCompile(`(?m)^\s*(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=`)

// sellingRoutePattern matches routes that only exist when someone is being
// sold something.
//
// Anchored to the directories frameworks actually serve routes from. Matched
// against any path, a microservice named services/billing/ or a
// docs/pricing.md was enough to call an internal tool a business and charge it
// $20/mo.
var sellingRoutePattern = regexp.MustCompile(
	`(?i)(^|/)(app|pages|src/pages|src/routes|routes|views|templates)/[^/]*(pricing|checkout|subscribe)(/|\.[a-z]+$)`)

// isEnvFile reports whether a path is an environment file, checked in or
// offered as a sample.
func isEnvFile(file string) bool {
	switch path.Base(file) {
	case ".env", ".env.example", ".env.sample", ".env.template":
		return true
	}
	return false
}

// DetectCommercial reports whether this repository is a commercial project.
//
// This is not about load. It decides eligibility: the free tiers most small
// web apps land on, Vercel's Hobby plan among them, are licensed for personal
// and non commercial use only. A commercial project on one of those plans has
// a bill coming on someone else's schedule.
//
// This detector answers "yes" or "unclear" and never "no". Nothing in a
// repository can prove an absence of commercial intent: plenty of businesses
// invoice outside the product and ship no payment code at all. Saying
// "unclear" lets the rules state the licensing condition rather than assume it
// away.
func DetectCommercial(repo *Repo) []Signal {
	credited := make(map[string]bool)
	var reasons, other []string

	// Sorted, so the evidence reads the same on every run. Go hands back the
	// dependency set in whatever order it likes.
	declared := DeclaredDependencies(repo)
	names := make([]string, 0, len(declared))
	for name := range declared {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		if processor, ok := ProcessorByDependency[name]; ok && !credited[processor] {
			credited[processor] = true
			reasons = append(reasons, "a manifest depends on "+name)
		}
		if businessTooling[name] {
			other = append(other, "a manifest depends on "+name)
		}
	}

	for _, file := range repo.Matching(isEnvFile) {
		for _, match := range envVariablePattern.FindAllStringSubmatch(repo.Read(file), -1) {
			// STRIPE_SECRET_KEY and StripeSecretKey are the same statement, so
			// the separators come out before the name is searched.
			name := strings.ToLower(strings.ReplaceAll(match[1], "_", ""))
			for _, vendor := range merchantCredentials {
				if !strings.Contains(name, vendor) {
					continue
				}
				if !credited[vendor] {
					credited[vendor] = true
					reasons = append(reasons, fmt.Sprintf("%s sets %s", file, match[1]))
				}
				break
			}
		}
	}

	if selling := repo.Matching(sellingRoutePattern.MatchString); len(selling) > 0 {
		other = append(other, fmt.Sprintf("a %s route", selling[0]))
	}

	reasons = append(reasons, other...)
	if len(reasons) > 0 {
		return []Signal{Found(FieldCommercial, High, strings.Join(reasons, "; "), "yes")}
	}

	return []Signal{Found(FieldCommercial, Low,
		"nothing here shows money changing hands, which is not the same as showing it does not",
		"unclear")}
}
