package main_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The other suites exercise the packages. This one runs the artifact that
// actually ships.

func binary(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "shiftpoint")
	build := exec.Command("go", "build", "-o", path, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build failed: %v\n%s", err, out)
	}
	return path
}

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestBinaryWritesEveryGolden(t *testing.T) {
	tool, root := binary(t), repoRoot(t)

	entries, err := os.ReadDir(filepath.Join(root, "fixtures"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			work := t.TempDir()
			copyTree(t, filepath.Join(root, "fixtures", entry.Name()), work)

			if out, err := exec.Command(tool, work, "--write").CombinedOutput(); err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
			got, err := os.ReadFile(filepath.Join(work, "INFRA.md"))
			if err != nil {
				t.Fatal(err)
			}
			want, err := os.ReadFile(filepath.Join(root, "goldens", entry.Name()+".md"))
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != string(want) {
				t.Errorf("golden mismatch\n--- got ---\n%s", got)
			}
		})
	}
}

func TestBinaryCarriesItsOwnRules(t *testing.T) {
	// A Go binary embeds its rules, so it cannot ship without them. The
	// previous implementation resolved them at run time and silently fell back
	// to the source checkout, which meant a build with no data passed every
	// test and failed on every machine that was not the one it was built on.
	//
	// Running from a directory with no checkout above it proves the embedding.
	tool := binary(t)
	elsewhere := t.TempDir()
	if err := os.WriteFile(filepath.Join(elsewhere, "index.html"), []byte("<h1>hi</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}

	command := exec.Command(tool, elsewhere)
	command.Dir = elsewhere
	command.Env = []string{"PATH=" + os.Getenv("PATH")}

	out, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if !strings.Contains(string(out), "Free static hosting covers this") {
		t.Errorf("got %s", out)
	}
}

func TestBinaryAnalyzesTheCurrentDirectoryByDefault(t *testing.T) {
	tool, root := binary(t), repoRoot(t)
	command := exec.Command(tool)
	command.Dir = filepath.Join(root, "fixtures", "static-site")
	out, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(out), "Stage:    Free static hosting") {
		t.Errorf("got %s", out)
	}
}

func TestBinaryExitsNonZeroOnAMissingPath(t *testing.T) {
	tool := binary(t)
	err := exec.Command(tool, filepath.Join(t.TempDir(), "absent")).Run()
	if err == nil {
		t.Fatal("expected a non zero exit")
	}
}

func TestBinaryStaysQuietWhenItsOutputIsClosedEarly(t *testing.T) {
	// Piping into head closes stdout. A stack trace in front of somebody who
	// wanted the first few lines is not an answer.
	//
	// A closed pipe is POSIX behaviour and this reaches for a POSIX shell to
	// provoke it. Windows reports the same situation differently and has no sh
	// to run, so the case does not exist there to be tested.
	if runtime.GOOS == "windows" {
		t.Skip("no POSIX shell, and a closed pipe reports differently")
	}
	tool, root := binary(t), repoRoot(t)
	command := exec.Command("sh", "-c", tool+" "+filepath.Join(root, "fixtures", "k8s-overkill")+" | head -2")
	out, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	if strings.Contains(string(out), "panic") || strings.Contains(string(out), "goroutine") {
		t.Errorf("printed a stack trace: %s", out)
	}
}

func copyTree(t *testing.T, from, to string) {
	t.Helper()
	entries, err := os.ReadDir(from)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		source, target := filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				t.Fatal(err)
			}
			copyTree(t, source, target)
			continue
		}
		data, err := os.ReadFile(source)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
