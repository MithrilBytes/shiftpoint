package rules

import (
	"regexp"
	"testing"
	"time"
)

// How long a price may go unchecked. Providers move prices and withdraw free
// tiers without announcing either, and a stale figure is worse than no figure:
// a founder acts on it.
//
// Nothing here reaches the network. The check is that somebody looked
// recently, not that the number is right, because no machine readable source
// exists for most of what this tool quotes.
const priceShelfLife = 180 * 24 * time.Hour

var readOn = regexp.MustCompile(`read (\d{4}-\d{2}-\d{2})`)

// sourced is every rule that cites a source, with where to complain.
func sourced(t *testing.T) map[string]string {
	t.Helper()
	set, err := Load()
	if err != nil {
		t.Fatal(err)
	}

	cited := map[string]string{}
	for _, stage := range set.Stages {
		if source := stage.Scalars["source"]; source != "" {
			cited["stage "+stage.ID] = source
		}
	}
	for _, flag := range set.Flags {
		if source := flag.Scalars["source"]; source != "" {
			cited["flag "+flag.ID] = source
		}
	}
	return cited
}

func TestEverySourceCarriesARealDate(t *testing.T) {
	// A date that does not parse is the same as no date, and the format check
	// alone accepted 2026-13-45.
	for where, source := range sourced(t) {
		match := readOn.FindStringSubmatch(source)
		if match == nil {
			t.Errorf("%s cites a source with no read date: %q", where, source)
			continue
		}
		if _, err := time.Parse("2006-01-02", match[1]); err != nil {
			t.Errorf("%s was read on %q, which is not a date", where, match[1])
		}
	}
}

func TestNoPriceIsOlderThanItsShelfLife(t *testing.T) {
	oldest := time.Now().Add(-priceShelfLife)

	for where, source := range sourced(t) {
		match := readOn.FindStringSubmatch(source)
		if match == nil {
			continue
		}
		read, err := time.Parse("2006-01-02", match[1])
		if err != nil {
			continue
		}
		if read.Before(oldest) {
			t.Errorf("%s was last checked on %s, which is over %d days ago. Go and look at the provider's pricing page, then update the number and the date together.",
				where, match[1], int(priceShelfLife.Hours()/24))
		}
	}
}

func TestNoSourceIsDatedInTheFuture(t *testing.T) {
	// A typo in the year reads as fresh forever, which defeats the point.
	tomorrow := time.Now().Add(24 * time.Hour)

	for where, source := range sourced(t) {
		match := readOn.FindStringSubmatch(source)
		if match == nil {
			continue
		}
		read, err := time.Parse("2006-01-02", match[1])
		if err == nil && read.After(tomorrow) {
			t.Errorf("%s claims it was read on %s, which has not happened yet", where, match[1])
		}
	}
}
