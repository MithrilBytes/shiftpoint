package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func run(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Run(args, "v0.1.0", &out, &errOut)
	return code, out.String(), errOut.String()
}

// fixture copies a fixture out of the repository so a test that writes into it
// cannot dirty the tree.
func fixture(t *testing.T, name string) string {
	t.Helper()
	root := t.TempDir()
	source := filepath.Join("..", "..", "fixtures", name)
	var copyTree func(from, to string) error
	copyTree = func(from, to string) error {
		items, err := os.ReadDir(from)
		if err != nil {
			return err
		}
		for _, item := range items {
			source, target := filepath.Join(from, item.Name()), filepath.Join(to, item.Name())
			if item.IsDir() {
				if err := os.MkdirAll(target, 0o755); err != nil {
					return err
				}
				if err := copyTree(source, target); err != nil {
					return err
				}
				continue
			}
			data, err := os.ReadFile(source)
			if err != nil {
				return err
			}
			if err := os.WriteFile(target, data, 0o644); err != nil {
				return err
			}
		}
		return nil
	}
	if err := copyTree(source, root); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestParse(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want Options
	}{
		{"no arguments means here", nil, Options{Path: "."}},
		{"flags in any order", []string{"--json", "some/repo", "--write"},
			Options{Path: "some/repo", JSON: true, Write: true}},
		{"short forms", []string{"-h"}, Options{Path: ".", Help: true}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := Parse(testCase.args)
			if err != nil {
				t.Fatal(err)
			}
			if got != testCase.want {
				t.Errorf("got %+v, want %+v", got, testCase.want)
			}
		})
	}
}

func TestParseRejectsRatherThanIgnores(t *testing.T) {
	// A mistyped flag that is silently ignored looks like it worked.
	for _, args := range [][]string{{"--depth=3"}, {"a", "b"}} {
		if _, err := Parse(args); err == nil {
			t.Errorf("accepted %v", args)
		}
	}
}

func TestRunPrintsAVerdict(t *testing.T) {
	code, out, errOut := run(t, filepath.Join("..", "..", "fixtures", "static-site"))
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if !strings.Contains(out, "Stage:    Free static hosting covers this (est. $0/mo)") {
		t.Errorf("got %q", out)
	}
	if errOut != "" {
		t.Errorf("wrote to stderr on success: %q", errOut)
	}
}

func TestRunKeepsStdoutParseableWhenWritingAndPrintingJSON(t *testing.T) {
	// The "Wrote ..." notice is status, not output. On stdout it made --json
	// unparseable for anything downstream.
	root := fixture(t, "static-site")
	code, out, errOut := run(t, root, "--json", "--write")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(out), &decoded); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, out)
	}
	if !strings.Contains(errOut, "Wrote ") {
		t.Error("the notice did not reach stderr")
	}
	if _, err := os.Stat(filepath.Join(root, "INFRA.md")); err != nil {
		t.Error("INFRA.md was not written")
	}
}

func TestRunWritesTheSameFileEveryTime(t *testing.T) {
	root := fixture(t, "nextjs-crud")
	if err := os.WriteFile(filepath.Join(root, "INFRA.md"), []byte("# stale\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	run(t, root, "--write")
	first, err := os.ReadFile(filepath.Join(root, "INFRA.md"))
	if err != nil {
		t.Fatal(err)
	}
	run(t, root, "--write")
	second, err := os.ReadFile(filepath.Join(root, "INFRA.md"))
	if err != nil {
		t.Fatal(err)
	}

	if string(first) != string(second) {
		t.Error("two runs produced different files")
	}
	if strings.Contains(string(first), "stale") {
		t.Error("an older file was not replaced")
	}
}

func TestRunReportsAPathItCannotWrite(t *testing.T) {
	// Chmod on Windows toggles a read only attribute on files and does not
	// stop a directory accepting new ones, so there is no read only directory
	// to fail against.
	if runtime.GOOS == "windows" {
		t.Skip("a directory cannot be made read only this way")
	}
	root := fixture(t, "static-site")
	if err := os.Chmod(root, 0o555); err != nil {
		t.Skipf("cannot make a read only directory: %v", err)
	}
	defer os.Chmod(root, 0o755)

	code, _, errOut := run(t, root, "--write")
	if code != 1 {
		t.Errorf("exit %d, want 1", code)
	}
	if !strings.Contains(errOut, "Could not write") {
		t.Errorf("unhelpful message: %q", errOut)
	}
}

func TestRunFailsPlainlyOnABadPath(t *testing.T) {
	code, out, errOut := run(t, filepath.Join(t.TempDir(), "absent"))
	if code != 1 {
		t.Errorf("exit %d, want 1", code)
	}
	if !strings.Contains(errOut, "does not exist.") {
		t.Errorf("got %q", errOut)
	}
	if out != "" {
		t.Errorf("wrote to stdout on failure: %q", out)
	}
}

func TestRunRejectsAFileWhereADirectoryBelongs(t *testing.T) {
	file := filepath.Join(t.TempDir(), "README.md")
	if err := os.WriteFile(file, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	code, _, errOut := run(t, file)
	if code != 1 || !strings.Contains(errOut, "is not a directory") {
		t.Errorf("exit %d: %q", code, errOut)
	}
}

func TestRunPrintsHelpAndVersionWithoutAnalyzing(t *testing.T) {
	if _, out, _ := run(t, "--help"); !strings.Contains(out, "Makes no network calls.") {
		t.Error("help does not describe the tool")
	}
	if _, out, _ := run(t, "--version"); strings.TrimSpace(out) != "v0.1.0" {
		t.Errorf("got %q", out)
	}
}
