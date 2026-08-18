// Package render turns one verdict into the surfaces people read it on.
//
// All three renderers emit the same four fields in the same order. Nothing
// renderer specific reaches back upstream.
package render

import (
	"strings"

	"github.com/MithrilBytes/shiftpoint/rules"
)

// Narrow enough to read in a split terminal and to paste into a message.
const (
	width      = 70
	labelWidth = 10
)

// Terminal renders a verdict for a person reading it in a shell.
func Terminal(verdict rules.Verdict) string {
	flags := verdict.Flags
	if len(flags) == 0 {
		flags = []string{"None."}
	}

	blocks := []string{
		block("Stage", verdict.Stage),
		block("Headroom", verdict.Headroom),
		block("Tripwire", verdict.Tripwire),
		block("Flags", flags...),
		"",
		strings.Join(wrap(verdict.ConfidenceNote, width), "\n"),
	}
	if verdict.DoNothingToday {
		blocks = append(blocks, "", "Do nothing today.")
	}
	return strings.Join(blocks, "\n") + "\n"
}

// block lays a label in the gutter and wraps every paragraph beside it.
func block(label string, paragraphs ...string) string {
	head := label + ":" + strings.Repeat(" ", labelWidth-len(label)-1)
	indent := strings.Repeat(" ", labelWidth)

	var lines []string
	for _, paragraph := range paragraphs {
		lines = append(lines, wrap(paragraph, width-labelWidth)...)
	}
	for i, line := range lines {
		if i == 0 {
			lines[i] = head + line
		} else {
			lines[i] = indent + line
		}
	}
	return strings.Join(lines, "\n")
}

// wrap breaks text on whitespace. A word longer than the width goes on its own
// line rather than being cut, because a broken URL helps nobody.
func wrap(text string, at int) []string {
	var lines []string
	var line string
	for _, word := range strings.Fields(text) {
		switch {
		case line == "":
			line = word
		case len(line)+1+len(word) <= at:
			line += " " + word
		default:
			lines = append(lines, line)
			line = word
		}
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}
