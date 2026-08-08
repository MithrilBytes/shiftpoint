# Infrastructure

What this repository needs today, based only on the files in it.

**Stage:** Single small VPS is sufficient (est. $12-20/mo)

**Headroom:** This stack typically serves ~5k daily users at this tier

**Tripwire:** If you add background jobs or exceed ~50GB/mo bandwidth, revisit. Next tier is ~$40/mo.

**Flags:**

- Found Kubernetes manifests. Adds ~$70/mo and ops burden with no signal you need it yet.
- Found a Helm chart. It manages releases across a fleet of services, and this repository holds one.

Confidence: medium. Some of this is inferred from what the repository does not contain.

Written by shiftpoint. Run `shiftpoint --write` to update.
