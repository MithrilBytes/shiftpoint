# Infrastructure

What this repository needs today, based only on the files in it.

**Stage:** This is sized by the model it loads, not by how many people visit, so we will not put a price on it

**Headroom:** Machine learning runtimes need memory and often a GPU, and the cheapest servers cannot load them at all. What you need depends on the model, not on your traffic.

**Tripwire:** If you put a web endpoint in front of this, the endpoint and the model are two separate bills. Price the model against the hardware it needs, then run this again on the endpoint alone.

**Flags:** None.

Confidence: medium. Some of this is inferred from what the repository does not contain.

Written by shiftpoint. Run `shiftpoint --write` to update.
