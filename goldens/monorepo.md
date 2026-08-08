# Infrastructure

What this repository needs today, based only on the files in it.

**Stage:** A free managed tier covers this (est. $0/mo)

**Headroom:** Cloudflare Workers allows 100,000 requests a day free, and Vercel's free plan allows 100 GB of traffic a month, either of which is a long way off for a new app

**Tripwire:** Those free plans are licensed for personal, non commercial use, so the day this becomes a business it is about $20/mo whatever the traffic is doing. If you outgrow the request limits first, the next step is about $5/mo.

**Flags:** None.

Confidence: medium. Some of this is inferred from what the repository does not contain. This repository holds more than one deployable application, and the answer above treats them as a single system. Run this again inside each one for a closer answer.

Do nothing today.

Written by shiftpoint. Run `shiftpoint --write` to update.
