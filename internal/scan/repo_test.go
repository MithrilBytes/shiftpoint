package scan

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// build writes a throwaway repository and returns a view of it.
func build(t *testing.T, files map[string]string) *Repo {
	t.Helper()
	root := t.TempDir()
	for path, content := range files {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	repo, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	return repo
}

func TestOpenSortsAndNormalisesPaths(t *testing.T) {
	repo := build(t, map[string]string{
		"src/b.go":   "package b",
		"a.go":       "package a",
		"src/c/d.go": "package d",
	})

	want := []string{"a.go", "src/b.go", "src/c/d.go"}
	if len(repo.Files) != len(want) {
		t.Fatalf("got %v, want %v", repo.Files, want)
	}
	for i, path := range want {
		if repo.Files[i] != path {
			t.Errorf("file %d: got %q, want %q", i, repo.Files[i], path)
		}
	}
}

func TestSkipsSampleMaterialAndDependencies(t *testing.T) {
	// A fixture is what the project analyzes, not what it is. Reading one lets
	// a test case decide the verdict for the repository around it.
	repo := build(t, map[string]string{
		"main.go":                        "package main",
		"fixtures/app/package.json":      `{"dependencies":{"next":"^14"}}`,
		"testdata/x/requirements.txt":    "Django==5.0",
		"node_modules/left-pad/index.js": "module.exports=1",
		"vendor/thing/thing.go":          "package thing",
	})

	if len(repo.Files) != 1 || repo.Files[0] != "main.go" {
		t.Fatalf("got %v, want only main.go", repo.Files)
	}
}

func TestSkipsSeparateCheckouts(t *testing.T) {
	// A worktree or submodule holds a full copy of another repository.
	root := t.TempDir()
	mustWrite(t, root, "package.json", `{"dependencies":{"next":"^14"}}`)
	mustWrite(t, root, ".claude/worktrees/copy/.git", "gitdir: /elsewhere")
	mustWrite(t, root, ".claude/worktrees/copy/package.json", `{"dependencies":{"next":"^14"}}`)

	repo, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range repo.Files {
		if strings.Contains(path, "worktrees") {
			t.Fatalf("walked into a separate checkout: %s", path)
		}
	}
}

func TestSkipsVendoredTreeWhateverItIsCalled(t *testing.T) {
	// A virtual environment is as often env/ as venv/, so the marker file
	// identifies it rather than the name somebody gave it.
	repo := build(t, map[string]string{
		"app.py":                         "from flask import Flask",
		"env/pyvenv.cfg":                 "home = /usr",
		"env/lib/python3.11/x/driver.py": "import sqlite3",
	})

	for _, path := range repo.Files {
		if strings.HasPrefix(path, "env/") {
			t.Fatalf("walked into a virtual environment: %s", path)
		}
	}
}

func TestReadRefusesOversizeFilesAndSaysSo(t *testing.T) {
	repo := build(t, map[string]string{
		"requirements.txt": "Flask==3.0.3\n" + strings.Repeat("#", maxReadBytes+1),
	})

	if got := repo.Read("requirements.txt"); got != "" {
		t.Errorf("expected a refusal, read %d bytes", len(got))
	}
	if unread := repo.Unread(); len(unread) != 1 || unread[0] != "requirements.txt" {
		t.Errorf("refusal not reported: %v", unread)
	}
}

func TestReadMissingFileIsEmptyNotAnError(t *testing.T) {
	repo := build(t, map[string]string{"a.go": "package a"})
	if got := repo.Read("nope.go"); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestSymlinkedManifestIsFollowed(t *testing.T) {
	// pnpm workspaces and Nix style layouts symlink manifests as a matter of
	// course, and skipping them made a whole repository invisible.
	root := t.TempDir()
	target := filepath.Join(t.TempDir(), "package.json")
	if err := os.WriteFile(target, []byte(`{"name":"x"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "package.json")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	repo, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if !repo.Has("package.json") {
		t.Fatal("symlinked manifest was skipped")
	}
	if repo.Read("package.json") == "" {
		t.Fatal("symlinked manifest read as empty")
	}
}

func TestSymlinkLoopDoesNotHang(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "a.go", "package a")
	if err := os.Symlink(root, filepath.Join(root, "self")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := Open(root); err != nil {
		t.Fatal(err)
	}
}

func TestWeakestCapsAtTheWorstEvidence(t *testing.T) {
	cases := []struct {
		name   string
		levels []Confidence
		want   Confidence
	}{
		{"empty is high", nil, High},
		{"one low drags it down", []Confidence{High, High, Low}, Low},
		{"medium wins over high", []Confidence{High, Medium}, Medium},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Weakest(testCase.levels...); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func mustWrite(t *testing.T, root, path, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
