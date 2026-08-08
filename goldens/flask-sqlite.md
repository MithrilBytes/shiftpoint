# Infrastructure

What this repository needs today, based only on the files in it.

**Stage:** One small always on server (est. $4-9/mo)

**Headroom:** This stack typically serves ~1k daily users at this tier

**Tripwire:** If you need a second server, or more than one writer at the same time, the single file database becomes the limit. Moving to a managed database is about $19/mo.

**Flags:** None.

Confidence: high. The files in this repository point clearly at this answer.

Do nothing today.

Written by shiftpoint. Run `shiftpoint --write` to update.
