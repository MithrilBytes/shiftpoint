// Package checks holds the house rules that apply to the whole repository
// rather than to any one package.
package checks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The em dash and the en dash are banned everywhere in this repository: code,
// comments, docs, terminal output, commit messages. Use a comma, a colon, a
// period, or parentheses.
//
// They are written as escapes here so this file does not trip its own check.
const (
	emDash = '\u2014'
	enDash = '\u2013'
)

var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "coverage": true,
	".next": true, "__pycache__": true,
}

var skipExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".avif": true, ".ico": true, ".pdf": true, ".mp4": true, ".webm": true,
	".mov": true, ".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
	".zip": true, ".gz": true, ".sum": true,
}

func TestNoBannedDashes(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}

	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if skipDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if skipExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() > 2<<20 {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		for number, line := range strings.Split(string(data), "\n") {
			if column := strings.IndexAny(line, string(emDash)+string(enDash)); column >= 0 {
				where, _ := filepath.Rel(root, path)
				t.Errorf("%s:%d:%d uses a dash this project bans", where, number+1, column+1)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
