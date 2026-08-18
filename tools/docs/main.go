// Command docs renders README.md into docs/index.html for GitHub Pages.
//
// The page is generated rather than written so the two cannot disagree. A test
// regenerates it and fails if the committed file differs, which is what stops a
// README edit from leaving a stale claim on the web.
//
// This is tooling. The shiftpoint binary does not import it, so the markdown
// parser it needs never reaches a release build.
package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

func main() {
	if err := build(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func build() error {
	page, err := Render(".")
	if err != nil {
		return err
	}
	target := filepath.Join("docs", "index.html")
	if err := os.WriteFile(target, []byte(page), 0o644); err != nil {
		return err
	}
	fmt.Printf("Wrote %s (%d bytes).\n", target, len(page))
	return nil
}

// Render turns the README at root into the finished page.
func Render(root string) (string, error) {
	readme, err := os.ReadFile(filepath.Join(root, "README.md"))
	if err != nil {
		return "", err
	}
	template, err := os.ReadFile(filepath.Join(root, "docs", "template.html"))
	if err != nil {
		return "", err
	}
	version, err := currentVersion(root)
	if err != nil {
		return "", err
	}

	tagline, body := split(string(readme))

	var rendered bytes.Buffer
	markdown := goldmark.New(goldmark.WithExtensions(extension.GFM))
	if err := markdown.Convert([]byte(body), &rendered); err != nil {
		return "", err
	}

	// Wide tables scroll inside themselves rather than pushing the page
	// sideways on a phone.
	content := strings.ReplaceAll(rendered.String(), "<table>", `<div class="scroll"><table>`)
	content = strings.ReplaceAll(content, "</table>", "</table></div>")

	page := strings.NewReplacer(
		"{{version}}", version,
		"{{tagline}}", tagline,
		"{{content}}", content,
	).Replace(string(template))

	if strings.ContainsAny(page, "\u2014\u2013") {
		return "", fmt.Errorf("the page would contain a dash this project bans")
	}
	return page, nil
}

// split takes the masthead out of the body. The heading and the opening
// sentence become the header, so the page does not say everything twice.
func split(readme string) (tagline, body string) {
	lines := strings.Split(readme, "\n")

	heading := -1
	for i, line := range lines {
		if strings.HasPrefix(line, "# ") {
			heading = i
			break
		}
	}
	start := len(lines)
	for i := heading + 2; i < len(lines); i++ {
		if strings.HasPrefix(lines[i], "## ") {
			start = i
			break
		}
	}

	opening := strings.Join(lines[heading+1:start], " ")
	if sentence, _, found := strings.Cut(opening, "."); found {
		tagline = strings.Join(strings.Fields(sentence), " ") + "."
	}
	return tagline, strings.Join(lines[start:], "\n")
}

// currentVersion reads the version the binary reports, so the badge and the
// build cannot disagree.
func currentVersion(root string) (string, error) {
	data, err := os.ReadFile(filepath.Join(root, "cmd", "shiftpoint", "main.go"))
	if err != nil {
		return "", err
	}
	_, rest, found := strings.Cut(string(data), `var version = "`)
	if !found {
		return "", fmt.Errorf("cmd/shiftpoint/main.go declares no version")
	}
	version, _, _ := strings.Cut(rest, `"`)
	return version, nil
}
