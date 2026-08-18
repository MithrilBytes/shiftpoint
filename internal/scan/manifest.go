package scan

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Shared readers for the dependency manifests several detectors need. Kept in
// one place so "what does this repository depend on" is answered the same way
// whether the question came from the framework, database, or jobs detector.
//
// These files are read to identify a project rather than to reason about it.
// This tool runs none of these languages and resolves none of their dependency
// trees. It reads the one line each file uses to name the framework and the
// database driver, which is the same thing it reads a Gemfile for.

// NameSet is a set of dependency names, lowercased, in the order the manifests
// declared them.
//
// The order is part of the contract. Detectors take the first name in a set
// that they recognise, and a Go map hands them a different first name on every
// run, which would make a verdict change while the repository did not.
type NameSet map[string]bool

// Add records names, lowercased. Blanks and repeats are ignored, so a caller
// can hand it whatever the manifest happened to contain.
func (s *NameSet) Add(names ...string) {
	for _, name := range names {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" {
			continue
		}
		if *s == nil {
			*s = make(NameSet)
		}
		(*s)[name] = true
	}
}

// Merge records every name in other.
func (s *NameSet) Merge(other NameSet) {
	for name := range other {
		s.Add(name)
	}
}

// Has reports whether a name was recorded.
func (s NameSet) Has(name string) bool { return s[strings.ToLower(name)] }

// HasAny reports whether any of the names was recorded.
func (s NameSet) HasAny(names ...string) bool {
	for _, name := range names {
		if s.Has(name) {
			return true
		}
	}
	return false
}

// Len is how many distinct names were recorded.
func (s NameSet) Len() int { return len(s) }

// All returns the names in sorted order, so evidence built from them reads the
// same on every run and on every filesystem.
func (s NameSet) All() []string {
	names := make([]string, 0, len(s))
	for name := range s {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Sorted returns the names alphabetically, for evidence that has to read the
// same way twice.
func (s NameSet) Sorted() []string {
	names := s.All()
	sort.Strings(names)
	return names
}

// Manifest is one language's dependency manifests: where they live, what they
// declare, and how a finding says where it came from.
//
// Every question asked of the whole repository walks this table, so a
// fourteenth language is one entry here rather than an edit in five places.
type Manifest struct {
	// Language is what to call this stack in a sentence.
	Language string

	// Files lists the manifests of this language in a repository.
	Files func(*Repo) []string

	// Dependencies lists the names those manifests declare.
	Dependencies func(*Repo) NameSet

	// Evidence is the fragment a detector completes with the name it matched,
	// as in "composer.json requires laravel/framework". It takes the repository
	// because the languages with several possible manifest names say which file
	// was actually read.
	Evidence func(*Repo) string

	// Generic marks a language this tool identifies but does not reason about.
	// The framework and database detectors read these through one shared loop,
	// which is what OtherLanguageSources hands them, while the languages below
	// have readers of their own that know how each spells a name.
	Generic bool
}

// Manifests is every dependency manifest read here, one entry per language.
//
// Order matters only in that it is stable: it decides the order names arrive
// in DeclaredDependencies, and therefore which name a detector reports when a
// repository declares two it recognises.
var Manifests = []Manifest{
	{
		Language:     "Node",
		Files:        PackageJSONFiles,
		Dependencies: NodeDependencies,
		Evidence:     func(*Repo) string { return "package.json depends on" },
	},
	{
		Language:     "Python",
		Files:        PythonManifestFiles,
		Dependencies: PythonDependencies,
		Evidence:     func(*Repo) string { return "a python manifest requires" },
	},
	{
		Language:     "Ruby",
		Files:        Gemfiles,
		Dependencies: RubyDependencies,
		Evidence:     func(*Repo) string { return "Gemfile requires" },
	},
	{
		Language:     "Go",
		Files:        GoModFiles,
		Dependencies: GoDependencies,
		Evidence:     func(*Repo) string { return "go.mod requires" },
	},
	{
		Language:     "Rust",
		Files:        CargoFiles,
		Dependencies: CargoDependencies,
		Evidence:     func(*Repo) string { return "Cargo.toml depends on" },
	},
	{
		Language:     "PHP",
		Files:        ComposerFiles,
		Dependencies: ComposerDependencies,
		Evidence:     func(*Repo) string { return "composer.json requires" },
		Generic:      true,
	},
	{
		Language:     "Elixir",
		Files:        MixFiles,
		Dependencies: ElixirDependencies,
		Evidence:     func(*Repo) string { return "mix.exs requires" },
		Generic:      true,
	},
	{
		Language:     "JVM",
		Files:        JVMBuildFiles,
		Dependencies: JVMDependencies,
		Evidence: func(repo *Repo) string {
			return firstFile(JVMBuildFiles(repo), "a JVM build file") + " declares"
		},
		Generic: true,
	},
	{
		Language:     ".NET",
		Files:        DotNetProjectFiles,
		Dependencies: DotNetDependencies,
		Evidence: func(repo *Repo) string {
			return firstFile(DotNetProjectFiles(repo), "a .NET project file") + " references"
		},
		Generic: true,
	},
	{
		Language:     "Deno",
		Files:        DenoManifestFiles,
		Dependencies: DenoDependencies,
		Evidence: func(repo *Repo) string {
			return firstFile(DenoManifestFiles(repo), "deno.json") + " imports"
		},
		Generic: true,
	},
}

// DependencySource is a set of declared names with the words to say where they
// came from.
type DependencySource struct {
	Names    NameSet
	Evidence string
}

// ManifestFiles returns every dependency manifest in the repository, whatever
// the language.
//
// A compose file is deliberately not one of these. It says how to run software
// rather than what the software depends on, and DeployedImages leans on the
// difference to tell a deployment of somebody else's application from an
// application of this repository's own.
func ManifestFiles(repo *Repo) []string {
	manifests := make(map[string]bool)
	for _, manifest := range Manifests {
		for _, file := range manifest.Files(repo) {
			manifests[file] = true
		}
	}
	// Filtered rather than concatenated, so the list reads in tree order the way
	// the repository does rather than grouped by whichever language came first
	// in the table.
	return repo.Matching(func(file string) bool { return manifests[file] })
}

// DeclaredDependencies returns everything the repository declares it depends
// on, whatever the language.
func DeclaredDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, manifest := range Manifests {
		names.Merge(manifest.Dependencies(repo))
	}
	return names
}

// OtherLanguageSources returns the manifests of the languages this tool
// identifies but does not reason about, each paired with how to say where a
// name came from.
//
// Kept together so the framework and database detectors read them the same
// way, and so the list of languages in this position is one line to extend.
func OtherLanguageSources(repo *Repo) []DependencySource {
	var sources []DependencySource
	for _, manifest := range Manifests {
		if !manifest.Generic {
			continue
		}
		sources = append(sources, DependencySource{
			Names:    manifest.Dependencies(repo),
			Evidence: manifest.Evidence(repo),
		})
	}
	return sources
}

// RuntimeDependencies returns only what the application needs in production.
//
// The distinction matters wherever a dependency implies something about how the
// code runs. Playwright in devDependencies is a test runner; the same name in
// dependencies would be a browser the service drives at request time. Treating
// them alike told an ordinary Express app it was sized by a machine learning
// model.
func RuntimeDependencies(repo *Repo) NameSet {
	names := nodeDependencyNames(repo, nodeRuntimeSections...)
	// Python, Ruby, and Go manifests do not separate the two in a form this tool
	// reads, so their names are runtime names as far as it can tell.
	names.Merge(PythonDependencies(repo))
	names.Merge(RubyDependencies(repo))
	names.Merge(GoDependencies(repo))
	// Cargo does draw the distinction, in a table of its own, so it is honoured.
	names.Merge(CargoRuntimeDependencies(repo))
	return names
}

// Where each language keeps its manifests. Matching is by base name, which is
// what a path pattern anchored at a slash or the start of the path amounts to.

// PackageJSONFiles returns every package.json.
func PackageJSONFiles(repo *Repo) []string { return repo.Named("package.json") }

// Gemfiles returns every Gemfile.
func Gemfiles(repo *Repo) []string { return repo.Named("Gemfile") }

// GoModFiles returns every go.mod.
func GoModFiles(repo *Repo) []string { return repo.Named("go.mod") }

// CargoFiles returns every Cargo.toml.
func CargoFiles(repo *Repo) []string { return repo.Named("Cargo.toml") }

// ComposerFiles returns every composer.json.
func ComposerFiles(repo *Repo) []string { return repo.Named("composer.json") }

// MixFiles returns every mix.exs.
func MixFiles(repo *Repo) []string { return repo.Named("mix.exs") }

// JVMBuildFiles returns every Maven pom and Gradle build file.
func JVMBuildFiles(repo *Repo) []string {
	return repo.Named("pom.xml", "build.gradle", "build.gradle.kts")
}

// DenoManifestFiles returns every deno.json and deno.jsonc.
//
// A deno.json and a .NET project file say the same thing in their own dialect:
// what the code imports and where each import resolves to. Refusing to open
// either left two mainstream runtimes invisible, which reads to their owners as
// "this tool has never heard of my stack".
func DenoManifestFiles(repo *Repo) []string { return repo.Named("deno.json", "deno.jsonc") }

// DotNetProjectFiles returns every C#, F#, and Visual Basic project file.
func DotNetProjectFiles(repo *Repo) []string {
	return repo.WithExtension(".csproj", ".fsproj", ".vbproj")
}

// PythonManifestFiles returns every requirements file and pyproject style
// manifest.
func PythonManifestFiles(repo *Repo) []string {
	return repo.Matching(func(file string) bool {
		return isRequirements(file) || isPythonProject(file)
	})
}

// ComposeFiles returns every Docker Compose file.
func ComposeFiles(repo *Repo) []string {
	return repo.Named("compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml")
}

// pythonProjectFiles name a Python project without pinning its dependencies.
var pythonProjectFiles = []string{"pyproject.toml", "Pipfile", "setup.py"}

func isPythonProject(file string) bool {
	base := baseName(file)
	for _, name := range pythonProjectFiles {
		if base == name {
			return true
		}
	}
	return false
}

// A requirements file is any of requirements.txt, requirements-dev.txt, or
// whatever else the project suffixed it with.
func isRequirements(file string) bool {
	base := baseName(file)
	return strings.HasPrefix(base, "requirements") && strings.HasSuffix(base, ".txt")
}

func baseName(file string) string {
	if slash := strings.LastIndex(file, "/"); slash >= 0 {
		return file[slash+1:]
	}
	return file
}

// Node.

// nodeDependencySections are the package.json blocks that name a dependency.
var nodeDependencySections = []string{"dependencies", "devDependencies", "peerDependencies"}

// nodeRuntimeSections are the ones the application still needs once it is
// deployed.
var nodeRuntimeSections = []string{"dependencies"}

// NodeManifest is one package.json that parsed, and the path it came from.
type NodeManifest struct {
	Path   string
	Fields map[string]any
}

// Has reports whether the manifest declares a field at all, however it is
// spelled. A field set to null counts as declared, because writing it down is
// the statement.
func (m NodeManifest) Has(field string) bool {
	_, declared := m.Fields[field]
	return declared
}

// Bool reports whether a field is the literal true. Anything else, including a
// string that says "true", is not.
func (m NodeManifest) Bool(field string) bool {
	value, _ := m.Fields[field].(bool)
	return value
}

// DependencyNames returns the names declared in the given blocks.
func (m NodeManifest) DependencyNames(sections ...string) NameSet {
	var names NameSet
	for _, section := range sections {
		// A dependencies that is a string, or a list, declares no packages. Half
		// the malformed manifests in the wild are exactly that.
		block, ok := m.Fields[section].(map[string]any)
		if !ok {
			continue
		}
		names.Add(sortedKeys(block)...)
	}
	return names
}

// NodeManifests returns every package.json that parses, paired with the path it
// came from.
func NodeManifests(repo *Repo) []NodeManifest {
	var manifests []NodeManifest
	for _, file := range PackageJSONFiles(repo) {
		fields, ok := readJSON(repo, file)
		if !ok {
			continue
		}
		manifests = append(manifests, NodeManifest{Path: file, Fields: fields})
	}
	return manifests
}

// NodeDependencies returns dependency names from every package.json, runtime
// and development alike.
func NodeDependencies(repo *Repo) NameSet {
	return nodeDependencyNames(repo, nodeDependencySections...)
}

func nodeDependencyNames(repo *Repo, sections ...string) NameSet {
	var names NameSet
	for _, manifest := range NodeManifests(repo) {
		names.Merge(manifest.DependencyNames(sections...))
	}
	return names
}

// Python.

var quotedToken = regexp.MustCompile(`["']([^"'\n]+)["']`)

// Where a distribution name stops and its version constraint, extras, or
// environment marker begins.
var requirementBoundary = regexp.MustCompile(`[\s=<>!~;\[\](),]`)

// PythonDependencies returns distribution names from requirements files and
// pyproject style manifests.
//
// pyproject parsing pulls every quoted token and keeps the leading name, which
// over collects harmlessly: the extra tokens do not collide with the names any
// detector looks for.
func PythonDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range PythonManifestFiles(repo) {
		text := repo.Read(file)
		if text == "" {
			continue
		}

		if isRequirements(file) {
			for _, line := range strings.Split(text, "\n") {
				names.Add(requirementName(line))
			}
			continue
		}

		for _, match := range quotedToken.FindAllStringSubmatch(text, -1) {
			names.Add(requirementName(match[1]))
		}
	}
	return names
}

// requirementName is the distribution a requirements line names, or "" when the
// line names none: a comment, a blank, or a flag such as -r or --index-url.
func requirementName(line string) string {
	withoutComment := strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
	if withoutComment == "" || strings.HasPrefix(withoutComment, "-") {
		return ""
	}
	return strings.TrimSpace(requirementBoundary.Split(withoutComment, 2)[0])
}

// Ruby.

var gemDeclaration = regexp.MustCompile(`gem\s+["']([^"']+)["']`)

// RubyDependencies returns gem names from every Gemfile.
func RubyDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range Gemfiles(repo) {
		for _, match := range gemDeclaration.FindAllStringSubmatch(repo.Read(file), -1) {
			names.Add(match[1])
		}
	}
	return names
}

// Go.

// A require line, with or without the keyword: the block form drops it.
var goRequirement = regexp.MustCompile(`^(?:require\s+)?([^\s()]+/[^\s()]+)\s+v\d`)

var goMajorVersion = regexp.MustCompile(`^v\d+$`)

// GoDependencies returns module names from every go.mod, normalised so a full
// import path can be matched against the same short names the other languages
// use. "github.com/go-chi/chi/v5" yields chi, "modernc.org/sqlite" yields
// sqlite, and "github.com/mattn/go-sqlite3" yields sqlite3.
func GoDependencies(repo *Repo) NameSet {
	var names NameSet

	for _, file := range GoModFiles(repo) {
		for _, rawLine := range strings.Split(repo.Read(file), "\n") {
			line := strings.TrimSpace(strings.SplitN(rawLine, "//", 2)[0])
			match := goRequirement.FindStringSubmatch(line)
			if match == nil {
				continue
			}

			module := strings.ToLower(match[1])
			names.Add(module)
			for _, segment := range strings.Split(module, "/") {
				// Version suffixes carry no meaning, and Go projects
				// conventionally prefix or suffix a package name with the
				// language.
				if goMajorVersion.MatchString(segment) {
					continue
				}
				names.Add(segment)
				names.Add(strings.TrimSuffix(strings.TrimPrefix(segment, "go-"), "-go"))
			}
		}
	}

	return names
}

// Rust.

// cargoDependencyTables are the Cargo tables that name a crate this package
// depends on.
var cargoDependencyTables = map[string]bool{
	"dependencies":       true,
	"dev-dependencies":   true,
	"build-dependencies": true,
}

var (
	cargoTableHeader = regexp.MustCompile(`^\[\[?([^\]]+)\]\]?$`)
	cargoEntry       = regexp.MustCompile(`^([A-Za-z0-9_-]+)\s*=`)
)

// CargoDependencies returns crate names from every Cargo.toml, including the
// ones only the tests and the build script need.
//
// Both spellings of a dependency table are read: the [dependencies] block with
// one crate per line, and the [dependencies.serde] block a crate gets when its
// options do not fit on one. Platform blocks such as
// [target.'cfg(unix)'.dependencies] end in the same table name and are read
// with the rest. This is not TOML parsing; it is the one line each entry uses
// to name a crate.
func CargoDependencies(repo *Repo) NameSet { return cargoDependencies(repo, true) }

// CargoRuntimeDependencies returns only the crates a built program links.
//
// Cargo separates what a program needs at run time from what only its tests and
// its build script need, the same distinction package.json draws between
// dependencies and devDependencies, so this can honour it.
func CargoRuntimeDependencies(repo *Repo) NameSet { return cargoDependencies(repo, false) }

func cargoDependencies(repo *Repo, includeDevelopment bool) NameSet {
	wanted := func(table string) bool {
		return table == "dependencies" || (includeDevelopment && cargoDependencyTables[table])
	}

	var names NameSet
	for _, file := range CargoFiles(repo) {
		inside := false
		for _, rawLine := range strings.Split(repo.Read(file), "\n") {
			line := strings.TrimSpace(strings.SplitN(rawLine, "#", 2)[0])

			if header := cargoTableHeader.FindStringSubmatch(line); header != nil {
				parts := strings.Split(header[1], ".")
				last := parts[len(parts)-1]
				parent := ""
				if len(parts) > 1 {
					parent = parts[len(parts)-2]
				}
				inside = cargoDependencyTables[last] && wanted(last)
				// [dependencies.clap] names the crate in the header itself.
				if !inside && cargoDependencyTables[parent] && wanted(parent) {
					names.Add(last)
				}
				continue
			}

			if !inside {
				continue
			}
			if entry := cargoEntry.FindStringSubmatch(line); entry != nil {
				names.Add(entry[1])
			}
		}
	}

	return names
}

// PHP.

// composerRequireSections are the composer.json blocks that name a package.
var composerRequireSections = []string{"require", "require-dev"}

// ComposerDependencies returns package names from every composer.json. Names
// keep their vendor prefix, because that is how PHP names a package and how the
// manifest spells it: laravel/framework, not framework.
func ComposerDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range ComposerFiles(repo) {
		fields, ok := readJSON(repo, file)
		if !ok {
			continue
		}
		for _, section := range composerRequireSections {
			block, ok := fields[section].(map[string]any)
			if !ok {
				continue
			}
			names.Add(sortedKeys(block)...)
		}
	}
	return names
}

// Elixir.

var mixDependency = regexp.MustCompile(`\{\s*:([a-z][a-z0-9_]*)\s*,`)

// ElixirDependencies returns application names from every mix.exs:
// {:phoenix, "~> 1.7"} yields phoenix.
func ElixirDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range MixFiles(repo) {
		for _, match := range mixDependency.FindAllStringSubmatch(repo.Read(file), -1) {
			names.Add(match[1])
		}
	}
	return names
}

// JVM.

var (
	mavenCoordinate = regexp.MustCompile(`<(?:groupId|artifactId)>\s*([^<\s]+)\s*</`)
	// Gradle writes a coordinate as one quoted string, group:artifact:version.
	gradleCoordinate = regexp.MustCompile(`["']([\w.-]+:[\w.-]+(?::[^"']*)?)["']`)
)

// JVMDependencies returns coordinates from every Maven pom and Gradle build
// file. Group and artifact are both kept, because either half can be the
// recognisable one: org.postgresql is the group, spring-boot-starter-web is the
// artifact.
//
// This is not dependency resolution. Nothing here follows a parent pom, reads a
// version catalogue, or expands a starter into what it pulls in.
func JVMDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range JVMBuildFiles(repo) {
		text := repo.Read(file)
		for _, match := range mavenCoordinate.FindAllStringSubmatch(text, -1) {
			names.Add(match[1])
		}
		for _, match := range gradleCoordinate.FindAllStringSubmatch(text, -1) {
			names.Add(strings.Split(match[1], ":")...)
		}
	}
	return names
}

// .NET.

var (
	dotnetPackage = regexp.MustCompile(`<(?:PackageReference|FrameworkReference)\s[^>]*Include\s*=\s*["']([^"']+)["']`)
	dotnetSDK     = regexp.MustCompile(`<Project\s[^>]*Sdk\s*=\s*["']([^"']+)["']`)
)

// DotNetDependencies returns package references and the SDK from every .NET
// project file.
//
// The SDK is kept alongside the packages because it is where a .NET project
// says what kind of thing it is. Microsoft.NET.Sdk.Web builds an application
// that listens; the plain Microsoft.NET.Sdk builds a console program. No
// package reference states that, so reading only the references would leave
// every ASP.NET service looking like a library of C# files.
func DotNetDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range DotNetProjectFiles(repo) {
		text := repo.Read(file)
		for _, match := range dotnetPackage.FindAllStringSubmatch(text, -1) {
			names.Add(match[1])
		}
		for _, match := range dotnetSDK.FindAllStringSubmatch(text, -1) {
			names.Add(match[1])
		}
	}
	return names
}

// Deno.

var (
	// deno.jsonc is allowed comments, and a JSON parser is not.
	blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	lineComment  = regexp.MustCompile(`(?m)^[ \t]*//.*$`)

	specifierSeparator = regexp.MustCompile(`[/:]`)
	// Scheme and registry words carry no package name of their own. Written as a
	// pattern rather than a list of quoted strings so this file states no
	// protocol name: the offline check greps the source for exactly that, and it
	// is right to.
	specifierNoise = regexp.MustCompile(`^(ht{2}ps?|npm|jsr|node|file|x|std)$`)
	// A version, not a name.
	specifierVersion = regexp.MustCompile(`^v?\d`)
)

// DenoDependencies returns names from every deno.json import map.
//
// Deno states a dependency as a specifier rather than a package name, so both
// halves are read: the alias on the left, which is what the code writes, and
// the URL or registry specifier on the right, which is what it resolves to.
// Every segment of each is kept, the same way go.mod paths are broken up, so a
// name is found wherever the specifier happens to carry it. That over collects
// hosts and path parts, which is harmless: none of them collide with the names
// a detector looks for.
func DenoDependencies(repo *Repo) NameSet {
	var names NameSet
	for _, file := range DenoManifestFiles(repo) {
		text := repo.Read(file)
		if text == "" {
			continue
		}
		text = lineComment.ReplaceAllString(blockComment.ReplaceAllString(text, ""), "")

		var fields map[string]any
		if err := json.Unmarshal([]byte(stripBOM(text)), &fields); err != nil {
			continue
		}
		imports, ok := fields["imports"].(map[string]any)
		if !ok {
			continue
		}
		for _, alias := range sortedKeys(imports) {
			names.Add(specifierNames(alias)...)
			if target, ok := imports[alias].(string); ok {
				names.Add(specifierNames(target)...)
			}
		}
	}
	return names
}

func specifierNames(specifier string) []string {
	var names []string
	for _, part := range specifierSeparator.Split(specifier, -1) {
		if part != "" && (part[0] == '$' || part[0] == '@') {
			part = part[1:]
		}
		name := strings.ToLower(strings.SplitN(part, "@", 2)[0])
		if name == "" || specifierNoise.MatchString(name) || specifierVersion.MatchString(name) {
			continue
		}
		names = append(names, name)
	}
	return names
}

// Compose.

// infrastructureImages are images that are infrastructure a service depends on,
// not the app itself.
var infrastructureImages = []string{
	"postgres", "postgis", "mysql", "mariadb", "mongo", "redis", "valkey",
	"memcached", "rabbitmq", "nats", "elasticsearch", "opensearch", "clickhouse",
	"minio", "localstack", "mailhog", "mailpit", "adminer", "traefik", "nginx",
}

// The registry and the official library namespace are both optional in a
// compose file, and postgres, docker.io/postgres, and library/postgres are the
// same image.
var infrastructureImage = regexp.MustCompile(
	`(?i)^(docker\.io/)?(library/)?(` + strings.Join(infrastructureImages, "|") + `)\b`,
)

// Compose is what a compose file says the system is made of. The type is named
// for the file rather than for its services so that ComposeServices, the reader
// below, can keep the name the rest of the codebase asks it by.
type Compose struct {
	// App are the services that are this repository's own application.
	App []string

	// Infrastructure are the backing services it runs alongside.
	Infrastructure []string

	// Images are every image named, in the order they were declared.
	Images []string

	// Deployed are application services that pull a prebuilt image instead of
	// building one.
	Deployed []string

	// HostBound are services wired to the machine they run on.
	//
	// A device node, the host's network namespace, or a privileged container are
	// each a statement that this deployment is that box and nowhere else. No
	// managed platform hands out /dev/dri or port 53 on the house LAN, so a
	// repository holding one of these is a machine's configuration rather than
	// an application somebody could host. Reading it as a deployment quotes a
	// server price for a home NAS that already has one.
	HostBound []string
}

// ComposeServices returns the services declared across every compose file,
// split into the application's own services and the backing services it runs
// alongside. A service that builds from source is the application; a service
// that pulls a known datastore or proxy image is not.
//
// The split decides how much of the system this repository is, so it returns
// nil rather than an empty answer when there was no compose file, or none that
// could be read: no services found and no services declared are different
// findings, and only one of them is evidence.
func ComposeServices(repo *Repo) *Compose {
	files := ComposeFiles(repo)
	if len(files) == 0 {
		return nil
	}

	services := &Compose{}
	read := false

	for _, file := range files {
		text := repo.Read(file)
		if text == "" {
			continue
		}
		// Only the services block is decoded into a node rather than a struct.
		// A compose file is hand written and routinely half finished, and a node
		// lets each field be read on its own terms instead of losing the whole
		// file to one field somebody typed as a string.
		var document struct {
			Services yaml.Node `yaml:"services"`
		}
		if err := yaml.Unmarshal([]byte(text), &document); err != nil {
			continue
		}
		if document.Services.Kind != yaml.MappingNode {
			continue
		}
		read = true

		// Walked as a node rather than decoded into a map, because a map has no
		// order and the application's services are quoted back to the reader in
		// the order the file declares them.
		content := document.Services.Content
		for i := 0; i+1 < len(content); i += 2 {
			name := content[i].Value
			service := content[i+1]

			image := stringField(service, "image")
			if image != "" {
				services.Images = append(services.Images, image)
			}

			if hasField(service, "devices") ||
				boolField(service, "privileged") ||
				stringField(service, "network_mode") == "host" {
				services.HostBound = append(services.HostBound, name)
			}

			if image != "" && infrastructureImage.MatchString(image) {
				services.Infrastructure = append(services.Infrastructure, name)
				continue
			}

			services.App = append(services.App, name)
			// Built from source here, or pulled ready made. The difference says
			// whether the application lives in this repository or somewhere else.
			if image != "" {
				services.Deployed = append(services.Deployed, name)
			}
		}
	}

	if !read {
		return nil
	}
	return services
}

// DeployedImages returns application services running a prebuilt image, in a
// repository that holds no dependency manifest of its own.
//
// A repository like that is not the application: it is the deployment of one.
// Small team and homelab self hosting looks exactly like this, a compose file
// pinning somebody else's image with the database it needs beside it. Requiring
// the absence of a manifest is what keeps this from firing on an ordinary
// project whose compose file happens to pin a tool alongside its own code.
func DeployedImages(repo *Repo) []string {
	if len(ManifestFiles(repo)) > 0 {
		return nil
	}
	services := ComposeServices(repo)
	if services == nil {
		return nil
	}
	return services.Deployed
}

// Package indexes.

var (
	homebrewFormula = regexp.MustCompile(`(?m)^\s*class\s+\w+\s*<\s*(Formula|Cask)\b`)
	homebrewCask    = regexp.MustCompile(`(?m)^\s*cask\s+["'][^"']+["']\s+do\b`)
)

// PackageIndexFiles returns source files that are package descriptions rather
// than code this repository runs: a Homebrew formula, a cask.
//
// They are written in Ruby and they are not a program. Nothing they describe is
// in the repository, and nothing in them ever runs anywhere but on the machine
// of the person installing it. A tap or a bucket is an index: the shape
// detector must not read one as a pile of scripts, and the language detector
// must not report a runtime for software that lives somewhere else.
func PackageIndexFiles(repo *Repo) []string {
	var files []string
	for _, file := range repo.WithExtension(".rb") {
		text := repo.Read(file)
		if homebrewFormula.MatchString(text) || homebrewCask.MatchString(text) {
			files = append(files, file)
		}
	}
	return files
}

// Reading files.

// readJSON parses a JSON object, and reports whether there was one to read. A
// manifest that is missing, unreadable, malformed, or not an object at all is
// the same finding: this file says nothing.
func readJSON(repo *Repo, file string) (map[string]any, bool) {
	text := repo.Read(file)
	if text == "" {
		return nil, false
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(stripBOM(text)), &fields); err != nil {
		return nil, false
	}
	return fields, fields != nil
}

// stripBOM drops a leading byte order mark. One is legal in a UTF-8 file and
// illegal in JSON, and editors on Windows still write them. Dropping it is the
// difference between reading a manifest and not seeing the project at all.
func stripBOM(text string) string { return strings.TrimPrefix(text, "\ufeff") }

// sortedKeys returns a JSON object's keys in a fixed order. The order a
// manifest declared them in does not survive parsing, and an arbitrary one
// would let the same repository answer differently on two runs. npm and
// composer both write these blocks sorted anyway.
func sortedKeys(block map[string]any) []string {
	keys := make([]string, 0, len(block))
	for key := range block {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// firstFile names the file a finding came from, or a stand in when there is
// none to name.
func firstFile(files []string, fallback string) string {
	if len(files) == 0 {
		return fallback
	}
	return files[0]
}

// Reading YAML.

// field returns the value of a key in a mapping node, or nil when the node is
// not a mapping or does not have the key.
func field(node *yaml.Node, key string) *yaml.Node {
	node = resolveAlias(node)
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return resolveAlias(node.Content[i+1])
		}
	}
	return nil
}

// resolveAlias follows an anchor to what it points at. Compose files reuse a
// block of common settings this way as a matter of course.
func resolveAlias(node *yaml.Node) *yaml.Node {
	for node != nil && node.Kind == yaml.AliasNode {
		node = node.Alias
	}
	return node
}

// hasField reports whether a key is present, whatever its value. A key written
// down with nothing after it is still a statement that it applies.
func hasField(node *yaml.Node, key string) bool { return field(node, key) != nil }

// stringField returns a key's value when it is a string, and "" otherwise. A
// port number where an image name belongs names no image.
func stringField(node *yaml.Node, key string) string {
	value := field(node, key)
	if value == nil || value.Kind != yaml.ScalarNode || value.Tag != "!!str" {
		return ""
	}
	return value.Value
}

// boolField reports whether a key is the literal true. A string that says
// "true" is not, which is the same distinction the rest of this file draws.
func boolField(node *yaml.Node, key string) bool {
	value := field(node, key)
	if value == nil {
		return false
	}
	var flag bool
	if err := value.Decode(&flag); err != nil {
		return false
	}
	return flag
}
