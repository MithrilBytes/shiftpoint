package scan

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Repo is a read only view of the repository being analyzed. Paths are
// relative to the root and use forward slashes on every platform, so detectors
// can match on them with plain patterns.
type Repo struct {
	Root  string
	Files []string

	sizes     map[string]int64
	cache     map[string]string
	unread    map[string]bool
	truncated bool
}

// Guards that keep a pathological repository from stalling a run. They do
// influence a verdict: a file that is never walked, and a file that is never
// read, are indistinguishable from a file that is not there. Both are reported
// so the answer can say what it did not see.
const (
	maxFiles     = 20000
	maxReadBytes = 1 << 20
)

// skipDirs are directories whose contents describe somebody else's work, or
// this project's own sample material. Reading either lets a dependency, or a
// test fixture, decide what the repository is.
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true, "out": true,
	".next": true, ".nuxt": true, ".svelte-kit": true, "vendor": true,
	"__pycache__": true, ".venv": true, "venv": true, "target": true,
	"coverage": true, ".terraform": true, ".cache": true, "site-packages": true,
	"third_party": true, "bower_components": true, "Pods": true,
	"fixtures": true, "__fixtures__": true, "testdata": true, "test-data": true,
	"testfixtures": true, "samples": true, "example": true, "examples": true,
	"__mocks__": true,
}

// vendorMarkers identify a dependency tree whatever somebody called it. A
// virtual environment is as often env/ as venv/.
var vendorMarkers = []string{"pyvenv.cfg", "site-packages"}

// Open walks a repository once and returns a view of it.
func Open(root string) (*Repo, error) {
	repo := &Repo{
		Root:   root,
		sizes:  make(map[string]int64),
		cache:  make(map[string]string),
		unread: make(map[string]bool),
	}
	if err := repo.walk(root); err != nil {
		return nil, err
	}
	repo.Files = make([]string, 0, len(repo.sizes))
	for path := range repo.sizes {
		repo.Files = append(repo.Files, path)
	}
	sort.Strings(repo.Files)
	repo.truncated = len(repo.Files) >= maxFiles
	return repo, nil
}

func (r *Repo) walk(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		// An unreadable directory is a gap in what was seen, not a reason to
		// abandon the repository around it.
		return nil
	}
	for _, entry := range entries {
		if len(r.sizes) >= maxFiles {
			return nil
		}
		full := filepath.Join(dir, entry.Name())

		if entry.IsDir() {
			if skipDirs[entry.Name()] || r.isSeparateCheckout(full) || r.isVendored(full) {
				continue
			}
			if err := r.walk(full); err != nil {
				return err
			}
			continue
		}

		// A symlink to a file is followed, because pnpm workspaces and Nix
		// style layouts symlink manifests. A symlink to a directory is not,
		// which is what keeps the walk acyclic.
		info, err := os.Stat(full)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		rel, err := filepath.Rel(r.Root, full)
		if err != nil {
			continue
		}
		r.sizes[filepath.ToSlash(rel)] = info.Size()
	}
	return nil
}

// isSeparateCheckout reports whether a directory carries its own .git. A
// worktree, a submodule, or a vendored clone belongs to another repository,
// and counting it makes one application look like several.
func (r *Repo) isSeparateCheckout(dir string) bool {
	_, err := os.Lstat(filepath.Join(dir, ".git"))
	return err == nil
}

func (r *Repo) isVendored(dir string) bool {
	for _, marker := range vendorMarkers {
		if _, err := os.Lstat(filepath.Join(dir, marker)); err == nil {
			return true
		}
	}
	return false
}

// Has reports whether a path exists in the repository.
func (r *Repo) Has(path string) bool {
	_, ok := r.sizes[path]
	return ok
}

// Bytes is the size of a path, or zero when it is not there.
func (r *Repo) Bytes(path string) int64 { return r.sizes[path] }

// Read returns a file's contents, or "" when it is missing or too large to
// read. A refusal is recorded, because a file that was never read looks
// exactly like a file that does not exist.
func (r *Repo) Read(path string) string {
	if text, ok := r.cache[path]; ok {
		return text
	}
	size, ok := r.sizes[path]
	if !ok {
		return ""
	}
	if size > maxReadBytes {
		r.unread[path] = true
		r.cache[path] = ""
		return ""
	}
	data, err := os.ReadFile(filepath.Join(r.Root, filepath.FromSlash(path)))
	if err != nil {
		r.cache[path] = ""
		return ""
	}
	r.cache[path] = string(data)
	return r.cache[path]
}

// Matching returns every path satisfying the predicate, in sorted order.
func (r *Repo) Matching(match func(string) bool) []string {
	var found []string
	for _, path := range r.Files {
		if match(path) {
			found = append(found, path)
		}
	}
	return found
}

// Named returns every path whose base name is one of the given names.
func (r *Repo) Named(names ...string) []string {
	wanted := make(map[string]bool, len(names))
	for _, name := range names {
		wanted[name] = true
	}
	return r.Matching(func(path string) bool { return wanted[filepath.Base(path)] })
}

// WithExtension returns every path ending in one of the given extensions,
// compared without regard to case.
func (r *Repo) WithExtension(extensions ...string) []string {
	return r.Matching(func(path string) bool {
		lower := strings.ToLower(path)
		for _, extension := range extensions {
			if strings.HasSuffix(lower, extension) {
				return true
			}
		}
		return false
	})
}

// Truncated reports whether the file cap was reached, leaving part of the tree
// unseen.
func (r *Repo) Truncated() bool { return r.truncated }

// Unread lists the files a read was refused for size.
func (r *Repo) Unread() []string {
	paths := make([]string, 0, len(r.unread))
	for path := range r.unread {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}
