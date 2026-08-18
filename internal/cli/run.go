// Package cli is the command line surface. It parses arguments, calls the
// analyzer once, and writes the result. It holds no analysis of its own.
package cli

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/MithrilBytes/shiftpoint/internal/render"
	"github.com/MithrilBytes/shiftpoint/rules"
)

const help = `shiftpoint: what infrastructure this repository actually needs.

Usage:
  shiftpoint [path]

Options:
  --json      Print the verdict as JSON.
  --write     Write INFRA.md into the analyzed repository.
  --version   Print the version.
  --help      Print this message.

Reads only the files in the repository. Makes no network calls.
`

// Options is what the arguments asked for.
type Options struct {
	Path    string
	JSON    bool
	Write   bool
	Help    bool
	Version bool
}

// Parse reads the arguments. An unknown option is an error rather than
// something silently ignored, because a mistyped flag should not look like it
// worked.
func Parse(args []string) (Options, error) {
	options := Options{Path: "."}
	pathSeen := false

	for _, arg := range args {
		switch arg {
		case "--json":
			options.JSON = true
		case "--write":
			options.Write = true
		case "--help", "-h":
			options.Help = true
		case "--version", "-v":
			options.Version = true
		default:
			if strings.HasPrefix(arg, "-") {
				return Options{}, fmt.Errorf("unknown option %q, run shiftpoint --help", arg)
			}
			if pathSeen {
				return Options{}, fmt.Errorf("expected one path, got a second one: %q", arg)
			}
			options.Path = arg
			pathSeen = true
		}
	}
	return options, nil
}

// Run is the whole command. It returns the process exit code, and writes
// everything through the given streams so a test can read what a user sees.
func Run(args []string, version string, out, errOut io.Writer) int {
	options, err := Parse(args)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}

	switch {
	case options.Help:
		fmt.Fprint(out, help)
		return 0
	case options.Version:
		fmt.Fprintln(out, version)
		return 0
	}

	root, err := filepath.Abs(options.Path)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}
	info, err := os.Stat(root)
	if errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(errOut, "%s does not exist.\n", root)
		return 1
	}
	if err != nil || !info.IsDir() {
		fmt.Fprintf(errOut, "%s is not a directory.\n", root)
		return 1
	}

	analysis, err := rules.Analyze(root)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}

	if options.Write {
		target := filepath.Join(root, "INFRA.md")
		if err := os.WriteFile(target, []byte(render.Markdown(analysis.Verdict)), 0o644); err != nil {
			fmt.Fprintf(errOut, "Could not write %s: %v\n", target, err)
			return 1
		}
		// A status line, not output. On stdout it made --json unparseable for
		// anything downstream.
		fmt.Fprintf(errOut, "Wrote %s\n", target)
	}

	if options.JSON {
		encoded, err := render.JSON(analysis.Verdict)
		if err != nil {
			fmt.Fprintln(errOut, err)
			return 1
		}
		fmt.Fprint(out, encoded)
		return 0
	}

	fmt.Fprint(out, render.Terminal(analysis.Verdict))
	return 0
}
