package scan

import (
	"strings"
	"testing"
)

func TestDetectAssetsWeighsAssetsAndNothingElse(t *testing.T) {
	repo := build(t, map[string]string{
		"images/logo.svg": strings.Repeat("x", 500),
		"src/app.ts":      strings.Repeat("y", 9000),
	})

	assets := signalFor(t, DetectAssets(repo), FieldAssetBytes)
	if assets.Metric != 500 {
		t.Errorf("got %d bytes, want 500", assets.Metric)
	}
	if assets.Evidence != "1 asset file(s) totalling 500 bytes" {
		t.Errorf("evidence does not show its work: %q", assets.Evidence)
	}
}

func TestEveryAssetExtensionIsWeighed(t *testing.T) {
	// Walking the table is what stops a deleted line quietly making a video
	// heavy repository look like a text file.
	for _, extension := range assetExtensions {
		t.Run(extension, func(t *testing.T) {
			repo := build(t, map[string]string{"static/thing" + extension: strings.Repeat("x", 64)})
			if got := signalFor(t, DetectAssets(repo), FieldAssetBytes).Metric; got != 64 {
				t.Errorf("got %d bytes, want 64", got)
			}
		})
	}
}

func TestAssetExtensionsIgnoreCase(t *testing.T) {
	repo := build(t, map[string]string{"static/LOGO.PNG": strings.Repeat("x", 16)})

	if got := signalFor(t, DetectAssets(repo), FieldAssetBytes).Metric; got != 16 {
		t.Errorf("got %d bytes, want 16", got)
	}
}

func TestAnEmptyRepositoryStillReportsAMeasurement(t *testing.T) {
	// Zero is a measurement. Reporting nothing would leave the threshold in
	// rules/ with nothing to compare against.
	assets := signalFor(t, DetectAssets(build(t, map[string]string{"main.go": "package main"})), FieldAssetBytes)

	if assets.Metric != 0 {
		t.Errorf("got %d bytes, want 0", assets.Metric)
	}
	if assets.Evidence == "" {
		t.Error("a measurement of zero still has to explain itself")
	}
}
