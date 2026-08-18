package render

import (
	"bytes"
	"encoding/json"

	"github.com/MithrilBytes/shiftpoint/rules"
)

// verdictJSON keeps the four contract fields first and in order, the same as
// every other renderer.
type verdictJSON struct {
	Schema         int      `json:"schema"`
	Stage          string   `json:"stage"`
	Headroom       string   `json:"headroom"`
	Tripwire       string   `json:"tripwire"`
	Flags          []string `json:"flags"`
	Confidence     string   `json:"confidence"`
	ConfidenceNote string   `json:"confidenceNote"`
	DoNothingToday bool     `json:"doNothingToday"`
}

// JSON renders a verdict for a machine.
func JSON(verdict rules.Verdict) (string, error) {
	flags := verdict.Flags
	if flags == nil {
		flags = []string{}
	}

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetIndent("", "  ")
	// Human readable prose routinely contains characters Go would otherwise
	// escape, and a founder pasting this into a ticket should see the sentence
	// rather than an escape sequence.
	encoder.SetEscapeHTML(false)

	err := encoder.Encode(verdictJSON{
		Schema:         1,
		Stage:          verdict.Stage,
		Headroom:       verdict.Headroom,
		Tripwire:       verdict.Tripwire,
		Flags:          flags,
		Confidence:     string(verdict.Confidence),
		ConfidenceNote: verdict.ConfidenceNote,
		DoNothingToday: verdict.DoNothingToday,
	})
	return buffer.String(), err
}
