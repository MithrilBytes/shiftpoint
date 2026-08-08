# Infrastructure

What this repository needs today, based only on the files in it.

**Stage:** A free function tier covers this (est. $0/mo)

**Headroom:** AWS Lambda gives 1 million requests a month free and does not expire, which is more than a script like this is likely to use

**Tripwire:** If this needs to answer faster than a cold start allows, or run longer than a few minutes at a time, you need a small always on server instead. That starts at about $4/mo. Past the free requests, cost rises by roughly $1 per additional million.

**Flags:** None.

Confidence: medium. Some of this is inferred from what the repository does not contain.

Do nothing today.

Written by shiftpoint. Run `shiftpoint --write` to update.
