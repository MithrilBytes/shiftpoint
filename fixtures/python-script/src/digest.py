"""Builds the weekly digest and drops it in the shared folder.

Runs once a week. Reads the CSV export, groups by team, writes a summary.
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

EXPORT = Path("data/export.csv")
OUTPUT = Path("data/digest.json")


def read_rows(path):
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def summarize(rows):
    totals = defaultdict(lambda: {"count": 0, "hours": 0.0})
    for row in rows:
        team = row["team"]
        totals[team]["count"] += 1
        totals[team]["hours"] += float(row["hours"])
    return {team: dict(values) for team, values in totals.items()}


def main():
    rows = read_rows(EXPORT)
    summary = summarize(rows)
    OUTPUT.write_text(json.dumps(summary, indent=2))
    print(f"wrote {OUTPUT} for {len(summary)} teams")


if __name__ == "__main__":
    main()
