package render

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/MithrilBytes/shiftpoint/rules"
)

var flagged = rules.Verdict{
	Stage:    "Single small VPS is sufficient (est. $12-20/mo)",
	Headroom: "This stack typically serves ~5k daily users at this tier",
	Tripwire: "If you add background jobs or exceed ~50GB/mo bandwidth, revisit. Next tier is ~$40/mo.",
	Flags: []string{
		"Found Kubernetes manifests. Adds ~$70/mo and ops burden with no signal you need it yet.",
		"Found a Helm chart. It manages releases across a fleet of services, and this repository holds one.",
	},
	Confidence:     rules.Medium,
	ConfidenceNote: "Confidence: medium. Some of this is inferred from what the repository does not contain.",
	DoNothingToday: false,
}

var quiet = rules.Verdict{
	Stage:          "Free static hosting covers this (est. $0/mo)",
	Headroom:       "Cloudflare Pages serves static files free",
	Tripwire:       "If you add a login, revisit.",
	Confidence:     rules.High,
	ConfidenceNote: "Confidence: high. The files in this repository point clearly at this answer.",
	DoNothingToday: true,
}

func TestTerminalPutsTheFourFieldsInOrderUnderAlignedLabels(t *testing.T) {
	lines := strings.Split(Terminal(flagged), "\n")
	want := []string{
		"Stage:    Single small VPS is sufficient (est. $12-20/mo)",
		"Headroom: This stack typically serves ~5k daily users at this tier",
		"Tripwire: If you add background jobs or exceed ~50GB/mo bandwidth,",
		"          revisit. Next tier is ~$40/mo.",
		"Flags:    Found Kubernetes manifests. Adds ~$70/mo and ops burden with",
		"          no signal you need it yet.",
	}
	for i, expected := range want {
		if lines[i] != expected {
			t.Errorf("line %d\n got: %q\nwant: %q", i, lines[i], expected)
		}
	}
}

func TestTerminalGivesEachFlagItsOwnParagraph(t *testing.T) {
	lines := strings.Split(Terminal(flagged), "\n")
	if lines[6] != "          Found a Helm chart. It manages releases across a fleet of" {
		t.Errorf("second flag not wrapped under the gutter: %q", lines[6])
	}
}

func TestTerminalNeverRunsPastSeventyColumns(t *testing.T) {
	for _, verdict := range []rules.Verdict{flagged, quiet} {
		for _, line := range strings.Split(Terminal(verdict), "\n") {
			if len(line) > width {
				t.Errorf("%d columns: %q", len(line), line)
			}
		}
	}
}

func TestTerminalSaysNoneAndClosesWithTheVerdict(t *testing.T) {
	output := Terminal(quiet)
	if !strings.Contains(output, "Flags:    None.") {
		t.Error("an empty flag list should read None.")
	}
	if !strings.HasSuffix(output, "\nDo nothing today.\n") {
		t.Error("the closing sentence is missing")
	}
	if strings.Contains(Terminal(flagged), "Do nothing today.") {
		t.Error("affirmed no action while flagging something to remove")
	}
}

func TestTerminalKeepsInternalMetricsOut(t *testing.T) {
	metric := regexp.MustCompile(`(?i)\b(CPU|RPS|p95|p99|IOPS|latency|throughput)\b`)
	for _, verdict := range []rules.Verdict{flagged, quiet} {
		if metric.MatchString(Terminal(verdict)) {
			t.Error("an internal metric reached a founder")
		}
	}
}

func TestTerminalCarriesTheConfidenceLine(t *testing.T) {
	// The confidence line is the tool's honesty mechanism and terminal is its
	// primary surface. A renderer that drops it fails silently otherwise.
	for _, verdict := range []rules.Verdict{flagged, quiet} {
		if !strings.Contains(Terminal(verdict), "Confidence: ") {
			t.Error("the confidence line is missing")
		}
	}
}

func TestMarkdownRendersFlagsAsBulletsAndOneAsWell(t *testing.T) {
	many := Markdown(flagged)
	if !strings.Contains(many, "**Flags:**\n\n- Found Kubernetes manifests.") {
		t.Error("multiple flags are not a bullet list")
	}

	// One flag is the common case in real repositories and had no test.
	single := flagged
	single.Flags = flagged.Flags[:1]
	if !strings.Contains(Markdown(single), "**Flags:**\n\n- Found Kubernetes") {
		t.Error("a lone flag is rendered differently from several")
	}

	if !strings.Contains(Markdown(quiet), "**Flags:** None.") {
		t.Error("no flags should read None.")
	}
}

func TestMarkdownKeepsTheFourFieldsInContractOrder(t *testing.T) {
	output := Markdown(quiet)
	order := []string{"**Stage:**", "**Headroom:**", "**Tripwire:**", "**Flags:**"}
	previous := -1
	for _, field := range order {
		at := strings.Index(output, field)
		if at <= previous {
			t.Errorf("%s is out of order", field)
		}
		previous = at
	}
	if !strings.HasSuffix(output, "\n") {
		t.Error("no trailing newline")
	}
}

func TestJSONEmitsTheFourFieldsFirstAndInOrder(t *testing.T) {
	encoded, err := JSON(flagged)
	if err != nil {
		t.Fatal(err)
	}

	var order []string
	decoder := json.NewDecoder(strings.NewReader(encoded))
	if _, err := decoder.Token(); err != nil {
		t.Fatal(err)
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			t.Fatal(err)
		}
		order = append(order, key.(string))
		var discard json.RawMessage
		if err := decoder.Decode(&discard); err != nil {
			t.Fatal(err)
		}
	}

	want := []string{"schema", "stage", "headroom", "tripwire", "flags", "confidence", "confidenceNote", "doNothingToday"}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Errorf("got %v, want %v", order, want)
	}
}

func TestJSONEmitsAnEmptyArrayRatherThanNull(t *testing.T) {
	encoded, err := JSON(quiet)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(encoded, `"flags": []`) {
		t.Errorf("a verdict with no flags should carry an empty array: %s", encoded)
	}
}

func TestEveryRendererReadsTheSameVerdict(t *testing.T) {
	encoded, err := JSON(quiet)
	if err != nil {
		t.Fatal(err)
	}
	for _, output := range []string{Terminal(quiet), Markdown(quiet)} {
		for _, field := range []string{quiet.Stage, quiet.Headroom, quiet.Tripwire} {
			if !strings.Contains(output, field) {
				t.Errorf("a renderer dropped %q", field)
			}
		}
		if !strings.Contains(output, "Do nothing today.") {
			t.Error("a renderer dropped the closing sentence")
		}
	}
	if !strings.Contains(encoded, quiet.Stage) {
		t.Error("json dropped the stage")
	}
}

func TestWrapKeepsALongWordWholeRatherThanCuttingIt(t *testing.T) {
	long := "https://example.com/pricing/compute/instances/general-purpose/details"
	lines := wrap("see "+long+" for more", 30)
	found := false
	for _, line := range lines {
		if line == long {
			found = true
		}
	}
	if !found {
		t.Errorf("a long token was broken: %v", lines)
	}
}
