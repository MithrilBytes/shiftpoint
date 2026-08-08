# Infrastructure

What this repository needs today, based only on the files in it.

**Stage:** A free managed tier covers this (est. $0/mo)

**Headroom:** Cloudflare Workers allows 100,000 requests a day free, and Vercel's free plan allows 100 GB of traffic a month, either of which is a long way off for a new app

**Tripwire:** If you start taking payments, the free plans are personal use only and you move to about $20/mo. If you outgrow the request limits first, the next step is about $5/mo.

**Flags:**

- Found Kubernetes manifests. The cluster alone is about $73/mo before a single server to run on, with no signal you need it yet.
- Found a Helm chart. It manages releases across a fleet of services, and this repository holds one.

Confidence: medium. Some of this is inferred from what the repository does not contain.

Written by shiftpoint. Run `shiftpoint --write` to update.
