package scan

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	indexHTMLPath  = regexp.MustCompile(`(^|/)index\.html$`)
	astroConfig    = regexp.MustCompile(`(^|/)astro\.config\.[cm]?[jt]s$`)
	nextConfig     = regexp.MustCompile(`(^|/)next\.config\.[cm]?[jt]s$`)
	blockedComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	slashedComment = regexp.MustCompile(`(?m)^[ \t]*//.*$`)
)

// An Astro adapter is what turns the default file build into a running server.
// It has to be installed to be imported, so the dependency list names it, and
// the configuration names it a second time for adapters this tool has not
// heard of.
var (
	astroAdapter    = regexp.MustCompile(`^@astrojs/(node|vercel|netlify|cloudflare|deno)$`)
	astroAdapterKey = regexp.MustCompile(`\badapter\s*:`)
	serverOutput    = regexp.MustCompile("output\\s*:\\s*[\"'`](server|hybrid)[\"'`]")
	staticExport    = regexp.MustCompile("output\\s*:\\s*[\"'`]export[\"'`]")
)

// liveConfiguration is a configuration file with the parts somebody switched
// off removed.
//
// A commented out line is a line that does not run, and reading one as live
// configuration is how a Next app that serves requests gets called a pile of
// files. Only comments that start a line are removed, so the two slashes in a
// URL keep the rest of their line.
func liveConfiguration(r *Repo, file string) string {
	return slashedComment.ReplaceAllString(blockedComment.ReplaceAllString(r.Read(file), ""), "")
}

// BuildOutputReader reports why a framework's build writes files. The second
// result is false when the build serves requests instead, which is the case
// where the framework's own name is the answer.
type BuildOutputReader func(*Repo) (reason string, buildsToFiles bool)

// BuildsToFiles holds the frameworks whose build output, not their name,
// decides whether anything runs in production.
//
// Astro and Next sit on opposite defaults, so each is read against its own.
// Astro builds to files unless a repository adds an adapter, and adding one is
// a deliberate act that leaves a dependency and a line of configuration
// behind. Next builds a server unless next.config asks for an export, which is
// the same deliberate act pointing the other way. Neither default is guessed
// at: the configuration is read, and what it does not say is as much a finding
// as what it does.
var BuildsToFiles = map[string]BuildOutputReader{
	"astro":  astroBuildsToFiles,
	"nextjs": nextBuildsToFiles,
}

func astroBuildsToFiles(r *Repo) (string, bool) {
	for name := range NodeDependencies(r) {
		if astroAdapter.MatchString(name) {
			return "", false
		}
	}

	configs := r.Matching(astroConfig.MatchString)
	for _, file := range configs {
		text := liveConfiguration(r, file)
		if serverOutput.MatchString(text) || astroAdapterKey.MatchString(text) {
			return "", false
		}
	}

	if len(configs) > 0 {
		return configs[0] + " sets no adapter, so the build writes files", true
	}
	return "no astro adapter is installed, so the build writes files", true
}

func nextBuildsToFiles(r *Repo) (string, bool) {
	// Every Next configuration in the repository has to export, not just one.
	// A monorepo holding an exported docs site next to a real application still
	// has an application in it, and that is the half with a bill attached.
	configs := r.Matching(nextConfig.MatchString)
	if len(configs) == 0 {
		return "", false
	}
	for _, file := range configs {
		if !staticExport.MatchString(liveConfiguration(r, file)) {
			return "", false
		}
	}
	return configs[0] + " sets output to export, so the build writes files", true
}

// Generator is a static site generator identified by its own configuration
// file rather than by a dependency.
type Generator struct {
	Name string
	// Config matches the path of the configuration file.
	Config *regexp.Regexp
	// Says is what that file has to contain to be this generator's.
	Says *regexp.Regexp
	// Tree matches the documents the generator builds from.
	Tree *regexp.Regexp
}

// Generators holds the generators that leave no dependency manifest behind.
// Hugo is one Go binary nobody vendors and Sphinx is usually installed outside
// the project, so the evidence is the configuration file each one is named
// after and the tree of documents it builds from. Both halves are required: a
// configuration file with nothing to build is not a site, and content with no
// generator is not one either.
var Generators = []Generator{
	{
		Name:   "hugo",
		Config: regexp.MustCompile(`^hugo\.(toml|ya?ml|json)$`),
		Says:   regexp.MustCompile(`.`),
		Tree:   regexp.MustCompile(`^content/`),
	},
	{
		Name:   "hugo",
		Config: regexp.MustCompile(`^config\.(toml|ya?ml)$`),
		Says:   regexp.MustCompile(`(?i)baseurl`),
		Tree:   regexp.MustCompile(`^content/`),
	},
	{
		Name:   "sphinx",
		Config: regexp.MustCompile(`^conf\.py$`),
		Says:   regexp.MustCompile(`sphinx|html_theme|master_doc`),
		Tree:   regexp.MustCompile(`\.(rst|md)$`),
	},
}

func staticGenerator(r *Repo) string {
	for _, generator := range Generators {
		file := ""
		for _, path := range r.Files {
			if generator.Config.MatchString(path) {
				file = path
				break
			}
		}
		if file == "" || !generator.Says.MatchString(r.Read(file)) {
			continue
		}
		content := r.Matching(generator.Tree.MatchString)
		if len(content) == 0 {
			continue
		}
		return fmt.Sprintf("%s is %s configuration, with %d file(s) for it to build",
			file, generator.Name, len(content))
	}
	return ""
}

// FrameworkByDependency maps a dependency name to the framework it names. It
// is shared with the detector that counts how many deployable applications a
// repository holds, so both answer "is this a web application" the same way.
var FrameworkByDependency = map[string]string{
	// Node
	"next":         "nextjs",
	"express":      "express",
	"fastify":      "fastify",
	"koa":          "koa",
	"hono":         "hono",
	"@nestjs/core": "nestjs",
	"astro":        "astro",
	// Static site generators. They build to files a free host serves, so they
	// answer the static question rather than the server one.
	"jekyll":           "static",
	"@11ty/eleventy":   "static",
	"eleventy":         "static",
	"gatsby":           "static",
	"@docusaurus/core": "static",
	"vitepress":        "static",
	"mkdocs":           "static",
	"nuxt":             "nuxt",
	"@sveltejs/kit":    "sveltekit",
	"@remix-run/node":  "remix",
	// Deno. Fresh renders on the server on every request, so it is the same kind
	// of thing as Nuxt or SvelteKit rather than a generator that writes files.
	"fresh": "fresh",
	// Python
	"flask":   "flask",
	"django":  "django",
	"fastapi": "fastapi",
	// Ruby
	"rails":   "rails",
	"sinatra": "sinatra",
	// Go, matched on the normalised segments GoDependencies produces
	"chi":   "chi",
	"gin":   "gin",
	"echo":  "echo",
	"fiber": "fiber",
	// Rust. A crate that puts an HTTP server in the process, which is what
	// separates a service from the far more common Rust repository: a program
	// somebody installs.
	"actix-web": "actix",
	"axum":      "axum",
	"rocket":    "rocket",
	"warp":      "warp",
	"poem":      "poem",
	"salvo":     "salvo",
	"tide":      "tide",
	// PHP, keeping the vendor prefix composer.json writes
	"laravel/framework":        "laravel",
	"laravel/lumen-framework":  "laravel",
	"symfony/framework-bundle": "symfony",
	"slim/slim":                "slim",
	// Elixir
	"phoenix": "phoenix",
	// JVM, matched on the artifact that puts an HTTP server in the process. A
	// starter that only wires up persistence or batch work is not a web
	// application, so spring-boot-starter on its own does not appear here.
	"spring-boot-starter-web":     "spring-boot",
	"spring-boot-starter-webflux": "spring-boot",
	"ktor-server-core":            "ktor",
	// Spring is not the only way to write a JVM service. Each of these puts an
	// HTTP server in the process the same way spring-boot-starter-web does.
	// Quarkus spells that several ways depending on the version and the codec,
	// so each spelling is listed rather than matched by prefix: quarkus-rest-
	// client is a client, and a prefix would have called it a server.
	"quarkus-rest":                      "quarkus",
	"quarkus-rest-jackson":              "quarkus",
	"quarkus-resteasy":                  "quarkus",
	"quarkus-resteasy-jackson":          "quarkus",
	"quarkus-resteasy-reactive":         "quarkus",
	"quarkus-resteasy-reactive-jackson": "quarkus",
	"quarkus-vertx-http":                "quarkus",
	"quarkus-undertow":                  "quarkus",
	"micronaut-http-server-netty":       "micronaut",
	"helidon-webserver":                 "helidon",
	"javalin":                           "javalin",
	// .NET states this in the SDK rather than in a package. Microsoft.NET.Sdk.Web
	// is the SDK that builds an application which listens; the plain SDK builds a
	// console program, and nothing else in a csproj tells the two apart.
	"microsoft.net.sdk.web":    "aspnet",
	"microsoft.aspnetcore.app": "aspnet",
}

// LanguageManifest is a language paired with the manifests that declare it.
type LanguageManifest struct {
	Language string
	Files    func(*Repo) []string
	// Manifest names the file when every manifest for this language has the
	// same name. It is empty when the name varies, in which case the first
	// file found is named instead.
	Manifest string
}

// LanguageManifests holds every language this tool identifies from a manifest,
// in the order they are reported.
//
// The last five are languages this tool identifies without being able to
// reason about them. A composer.json is as plain a statement of what a project
// runs on as a Gemfile is, and refusing to read it made the single most common
// shape of small web application on the planet invisible.
var LanguageManifests = []LanguageManifest{
	{Language: "node", Files: PackageJSONFiles, Manifest: "package.json"},
	{Language: "python", Files: PythonManifestFiles},
	{Language: "ruby", Files: Gemfiles, Manifest: "Gemfile"},
	{Language: "go", Files: GoModFiles, Manifest: "go.mod"},
	// A Cargo.toml states what a project runs on as plainly as a go.mod does.
	// Without it a Rust repository had no language at all, and the tool answered
	// "we could not tell what this repository runs" for a manifest that names the
	// package, its version and every crate it links.
	{Language: "rust", Files: CargoFiles, Manifest: "Cargo.toml"},
	{Language: "php", Files: ComposerFiles, Manifest: "composer.json"},
	{Language: "elixir", Files: MixFiles, Manifest: "mix.exs"},
	{Language: "java", Files: JVMBuildFiles},
	{Language: "dotnet", Files: DotNetProjectFiles},
	{Language: "deno", Files: DenoManifestFiles},
}

// SourceLanguage is a language read from a file extension rather than from a
// manifest.
type SourceLanguage struct {
	Language string
	Pattern  *regexp.Regexp
}

// SourceLanguages holds the extensions that stand in for a missing manifest.
var SourceLanguages = []SourceLanguage{
	{Language: "python", Pattern: regexp.MustCompile(`\.py$`)},
	{Language: "node", Pattern: regexp.MustCompile(`\.[cm]?[jt]sx?$`)},
	{Language: "ruby", Pattern: regexp.MustCompile(`\.rb$`)},
	{Language: "go", Pattern: regexp.MustCompile(`\.go$`)},
	{Language: "rust", Pattern: regexp.MustCompile(`\.rs$`)},
}

// DetectFramework reports the language and the framework. Both come from
// dependency manifests, which are the only place a project states what it runs
// on rather than what it happens to contain.
//
// Absence is reported at high confidence here because the method is a scan of
// every filename in the repository: a missing Gemfile really is a missing
// Gemfile.
func DetectFramework(r *Repo) []Signal {
	var languages, languageEvidence []string
	for _, entry := range LanguageManifests {
		files := entry.Files(r)
		if len(files) == 0 {
			continue
		}
		languages = append(languages, entry.Language)
		if entry.Manifest != "" {
			languageEvidence = append(languageEvidence, entry.Manifest)
		} else {
			languageEvidence = append(languageEvidence, files[0])
		}
	}

	// A manifest is the strongest evidence, but plenty of real projects are a
	// few source files and a virtual environment that is not checked in. Falling
	// back to file extensions keeps those visible, at lower confidence, because
	// the code is evidence even when the dependency list is missing.
	language := languageFromSources(r)
	if len(languages) > 0 {
		language = Found(FieldLanguage, High, "found "+strings.Join(languageEvidence, ", "), languages...)
	}

	sources := append([]DependencySource{
		{NodeDependencies(r), "package.json depends on"},
		{PythonDependencies(r), "a python manifest requires"},
		{RubyDependencies(r), "Gemfile requires"},
		{GoDependencies(r), "go.mod requires"},
		{cargoDependencies(r, true), "Cargo.toml depends on"},
	}, OtherLanguageSources(r)...)

	var frameworks, frameworkEvidence []string
	seen := map[string]bool{}
	for _, source := range sources {
		// Sorted so the evidence a repository gets does not depend on the order
		// a map happened to hand back.
		names := make([]string, 0, len(source.Names))
		for name := range source.Names {
			names = append(names, name)
		}
		sort.Strings(names)

		for _, name := range names {
			declared, known := FrameworkByDependency[name]
			if !known {
				continue
			}
			// What a repository installed and what it ships are different
			// questions wherever the framework builds to files under one
			// configuration and runs a server under another.
			framework, reason := declared, ""
			if read, reads := BuildsToFiles[declared]; reads {
				if why, toFiles := read(r); toFiles {
					framework, reason = "static", why
				}
			}
			if seen[framework] {
				continue
			}
			seen[framework] = true
			frameworks = append(frameworks, framework)
			if reason == "" {
				frameworkEvidence = append(frameworkEvidence, source.Evidence+" "+name)
			} else {
				frameworkEvidence = append(frameworkEvidence,
					fmt.Sprintf("%s %s, and %s", source.Evidence, name, reason))
			}
		}
	}
	sort.Strings(frameworks)

	// A generator that leaves no manifest still leaves its own configuration,
	// and that names the repository as surely as a dependency would. It is
	// checked before the HTML fallback below because these generators write
	// their HTML at build time, so there is none checked in to find.
	if len(frameworks) == 0 {
		if generator := staticGenerator(r); generator != "" {
			frameworks = append(frameworks, "static")
			frameworkEvidence = append(frameworkEvidence, generator)
		}
	}

	// Checked in HTML with no framework behind it is a static site. That is a
	// positive finding, not a fallback: both halves are evidence.
	//
	// A manifest does not disqualify it. Plenty of static sites carry a
	// package.json holding nothing but a formatter, and requiring zero manifests
	// made the tool abstain on exactly the repositories whose answer is easiest.
	// It does raise the bar to an index.html at the root, so that a stray
	// template deep inside an application cannot claim the whole repository.
	if len(frameworks) == 0 {
		html := r.Matching(indexHTMLPath.MatchString)
		if len(ManifestFiles(r)) == 0 {
			if len(html) > 0 {
				frameworks = append(frameworks, "static")
				frameworkEvidence = append(frameworkEvidence, html[0]+" with no dependency manifest")
			}
		} else if r.Has("index.html") {
			frameworks = append(frameworks, "static")
			frameworkEvidence = append(frameworkEvidence,
				"index.html at the root and no framework in any manifest")
		}
	}

	framework := Found(FieldFramework, Low,
		"no framework this tool recognizes appears in any manifest", "unknown")
	if len(frameworks) > 0 {
		framework = Found(FieldFramework, High, strings.Join(frameworkEvidence, "; "), frameworks...)
	}

	return []Signal{language, framework}
}

func languageFromSources(r *Repo) Signal {
	// A package description is not a program in the language it is written in.
	index := map[string]bool{}
	for _, file := range PackageIndexFiles(r) {
		index[file] = true
	}

	var found, evidence []string
	for _, entry := range SourceLanguages {
		files := r.Matching(func(file string) bool {
			return entry.Pattern.MatchString(file) && !index[file]
		})
		if len(files) == 0 {
			continue
		}
		found = append(found, entry.Language)
		evidence = append(evidence,
			fmt.Sprintf("%d %s source file(s), including %s", len(files), entry.Language, files[0]))
	}

	if len(found) == 0 {
		return Absent(FieldLanguage, High,
			"no dependency manifest and no source files this tool recognizes")
	}
	return Found(FieldLanguage, Medium,
		"no dependency manifest, but "+strings.Join(evidence, "; "), found...)
}
