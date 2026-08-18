package render

import (
	"strings"

	"github.com/MithrilBytes/shiftpoint/rules"
)

// Markdown renders a verdict as the INFRA.md written into the repository that
// was analyzed.
func Markdown(verdict rules.Verdict) string {
	flags := "**Flags:** None."
	if len(verdict.Flags) > 0 {
		var bullets []string
		for _, flag := range verdict.Flags {
			bullets = append(bullets, "- "+flag)
		}
		flags = "**Flags:**\n\n" + strings.Join(bullets, "\n")
	}

	sections := []string{
		"# Infrastructure",
		"What this repository needs today, based only on the files in it.",
		"**Stage:** " + verdict.Stage,
		"**Headroom:** " + verdict.Headroom,
		"**Tripwire:** " + verdict.Tripwire,
		flags,
		verdict.ConfidenceNote,
	}
	if verdict.DoNothingToday {
		sections = append(sections, "Do nothing today.")
	}
	sections = append(sections, "Written by shiftpoint. Run `shiftpoint --write` to update.")

	return strings.Join(sections, "\n\n") + "\n"
}
