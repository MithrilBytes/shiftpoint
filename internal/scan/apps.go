package scan

import (
	"fmt"
	"path"
	"strings"
)

// DetectApps reports how many separately deployable applications this
// repository holds.
//
// A verdict describes one system. When a repository holds several applications
// the single answer is still useful, but it is an answer about the whole, and
// the owner deserves to be told that rather than left to assume otherwise.
//
// An application root is a directory whose own manifest declares a web
// framework. A directory with a manifest and no framework is a package, not a
// deployment, so it does not count.
func DetectApps(r *Repo) []Signal {
	roots := newAppRoots()

	for _, manifest := range NodeManifests(r) {
		names := map[string]bool{}
		for _, key := range []string{"dependencies", "devDependencies"} {
			block, ok := manifest.Fields[key].(map[string]any)
			if !ok {
				continue
			}
			for name := range block {
				names[strings.ToLower(name)] = true
			}
		}
		roots.note(manifest.Path, names)
	}

	// Python and Ruby manifests are read as text rather than parsed, so the
	// framework names are looked for in the file itself. A manifest that
	// mentions one is the application root whichever key it appeared under.
	for _, file := range append(PythonManifestFiles(r), Gemfiles(r)...) {
		text := strings.ToLower(r.Read(file))
		names := map[string]bool{}
		for name := range FrameworkByDependency {
			if strings.Contains(text, name) {
				names[name] = true
			}
		}
		roots.note(file, names)
	}

	count := len(roots.order)
	if count > 1 {
		signal := Found(FieldApps, High,
			fmt.Sprintf("%d application roots: %s", count, strings.Join(roots.manifests(), ", ")),
			"several")
		signal.Metric = count
		return []Signal{signal}
	}

	confidence := Low
	evidence := "no manifest declares a web framework, so there is no application root to count"
	if count == 1 {
		confidence = High
		evidence = "one application root at " + roots.manifests()[0]
	}
	signal := Found(FieldApps, confidence, evidence, "one")
	signal.Metric = count
	return []Signal{signal}
}

// appRoots collects one manifest per directory that declares a web framework.
// Insertion order is kept so the evidence names roots in the order they were
// found rather than in whatever order a map hands back.
type appRoots struct {
	byDirectory map[string]string
	order       []string
}

func newAppRoots() *appRoots {
	return &appRoots{byDirectory: map[string]string{}}
}

// note records the manifest's directory as an application root when any of the
// names it declares is a web framework.
func (a *appRoots) note(file string, names map[string]bool) {
	for name := range names {
		if _, framework := FrameworkByDependency[name]; !framework {
			continue
		}
		root := path.Dir(file)
		if _, seen := a.byDirectory[root]; !seen {
			a.byDirectory[root] = file
			a.order = append(a.order, root)
		}
		return
	}
}

func (a *appRoots) manifests() []string {
	files := make([]string, 0, len(a.order))
	for _, root := range a.order {
		files = append(files, a.byDirectory[root])
	}
	return files
}
