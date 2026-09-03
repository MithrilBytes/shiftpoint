package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func root(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPageIsUpToDateWithTheReadme(t *testing.T) {
	// docs/index.html is generated. If somebody edits README.md and forgets to
	// rebuild, the site keeps making a claim the project no longer makes.
	base := root(t)
	committed, err := os.ReadFile(filepath.Join(base, "docs", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	rebuilt, err := Render(base)
	if err != nil {
		t.Fatal(err)
	}
	if rebuilt != string(committed) {
		t.Error("docs/index.html is stale, run: go run ./tools/docs")
	}
}

func TestPageStatesTheAccuracyTheCorpusMeasures(t *testing.T) {
	page, err := Render(root(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Holdout", "96.9%", "71.9%", "96.3%"} {
		if !strings.Contains(page, want) {
			t.Errorf("the page does not mention %s", want)
		}
	}
}

func TestPageCarriesTheVersionTheBinaryReports(t *testing.T) {
	base := root(t)
	page, err := Render(base)
	if err != nil {
		t.Fatal(err)
	}
	version, err := currentVersion(base)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(page, ">"+version+"<") {
		t.Errorf("the badge does not show %s", version)
	}
}

func TestSplitTakesTheMastheadOutOfTheBody(t *testing.T) {
	tagline, body := split("# name\n\nFirst sentence here. Second one.\n\n## Install\n\ntext\n")
	if tagline != "First sentence here." {
		t.Errorf("got %q", tagline)
	}
	if !strings.HasPrefix(body, "## Install") {
		t.Errorf("body starts with %q", body[:20])
	}
	if strings.Contains(body, "First sentence") {
		t.Error("the opening sentence is repeated in the body")
	}
}
