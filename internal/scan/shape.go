package scan

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Extensions the shape ladder counts. They are matched with Repo.WithExtension
// rather than with a pattern, because a suffix is all the question is.
var (
	// Only languages a managed or free function tier will actually run. A
	// repository of shell scripts and Swift files is tooling, and telling its
	// owner about Lambda pricing would be noise.
	scriptExtensions = []string{".py", ".js", ".mjs", ".cjs", ".ts", ".rb", ".go"}
	// Tabular files a repository publishes as its content. Deliberately not
	// .json or .yaml: those are configuration far more often than they are data.
	dataExtensions = []string{
		".csv", ".tsv", ".psv", ".parquet", ".jsonl", ".ndjson", ".arrow", ".feather", ".xls", ".xlsx",
	}
	markdownExtensions = []string{".md", ".mdx"}
)

var (
	// Where a program starts. A module carrying a main guard was written to be
	// run rather than imported, which is the plainest statement a repository
	// makes about itself when no framework names it.
	programEntry  = regexp.MustCompile(`(?m)^\s*if\s+__name__\s*==\s*["']__main__["']\s*:`)
	goMainPackage = regexp.MustCompile(`(?m)^\s*package\s+main\s*$`)

	workflowPath = regexp.MustCompile(`^\.github/workflows/[^/]+\.ya?ml$`)
	// A workflow that fires on a clock and runs commands of its own. Both halves
	// matter: a schedule without a run block is calling somebody else's action,
	// and a run block without a schedule is continuous integration for code
	// elsewhere.
	workflowSchedule = regexp.MustCompile(`(?m)^\s*schedule\s*:`)
	workflowRun      = regexp.MustCompile(`(?m)^\s*-?\s*run\s*:`)

	// What a Cargo package builds. A [[bin]] section names a binary outright,
	// and cargo builds one from src/main.rs or src/bin/*.rs without being asked.
	// A [lib] section or src/lib.rs is the other half of the same question.
	rustBinaryTarget  = regexp.MustCompile(`(?m)^\s*\[\[bin\]\]`)
	rustBinarySource  = regexp.MustCompile(`^src/(main\.rs|bin/[^/]+\.rs)$`)
	rustLibraryTarget = regexp.MustCompile(`(?m)^\s*\[lib\]`)

	// A directory whose name says the files in it are programs meant for a PATH.
	programDirectory = regexp.MustCompile(`^(bin|sbin|libexec)/`)
	makefilePath     = regexp.MustCompile(`(^|/)(GNUmakefile|[Mm]akefile)$`)

	// Infrastructure a repository packages rather than deploys: a Terraform
	// module or a Helm chart.
	infrastructurePackage = regexp.MustCompile(`\.tf(\.json)?$|(^|/)Chart\.ya?ml$`)

	// Where a repository states what its build does, whatever runs the build.
	ciConfigPath = regexp.MustCompile(`^(\.github/workflows/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci/config\.ya?ml)$|(^|/)(Jenkinsfile|GNUmakefile|[Mm]akefile)$`)
	// A build step that sends the image it just built to a registry.
	pushesAnImage = regexp.MustCompile(`docker/build-push-action|\b(docker|podman|buildah|nerdctl)\s+(image\s+)?push\b|(^|\s)--push(\s|$)|\bskopeo\s+copy\b|\bkaniko\b`)
)

// DetectShape reports what kind of thing this repository is, which decides
// whether any hosting advice applies at all.
//
// Most tools assume every repository is a service waiting for a server. Plenty
// of them are notebooks, libraries, command line tools, or a single script.
// Telling the owner of a Jupyter notebook to rent a server is worse than saying
// nothing, so this detector exists to let the rules say "there is nothing to
// host here" instead.
//
// The order of the ladder below is load bearing. Every branch in it records a
// repository the branch above it used to answer wrongly.
func DetectShape(r *Repo) []Signal {
	detected := firstSignal(DetectFramework(r), FieldFramework)
	frameworks := detected.Values
	isStatic := slices.Contains(frameworks, "static")
	isService := false
	for _, value := range frameworks {
		if value != "static" && value != "unknown" {
			isService = true
		}
	}

	if isService {
		return shape("service", High,
			fmt.Sprintf("a web framework (%s) is in the manifest", strings.Join(frameworks, ", ")))
	}

	notebooks := r.WithExtension(".ipynb")
	// A formula or a cask is a package description, not source this repository
	// runs, so it cannot make the repository a pile of scripts.
	index := map[string]bool{}
	for _, file := range PackageIndexFiles(r) {
		index[file] = true
	}
	var scripts []string
	for _, file := range r.WithExtension(scriptExtensions...) {
		if !index[file] {
			scripts = append(scripts, file)
		}
	}

	// Notebooks are checked before packaging: a repository can carry a
	// pyproject.toml and still be an analysis, not something you deploy.
	//
	// Background work outranks them, though. A queue library means something here
	// runs on a schedule somebody depends on, and one scratch notebook next to a
	// Celery worker used to answer "there is nothing to host here" at high
	// confidence, which is the opposite of true.
	queues := firstSignal(DetectJobs(r), FieldJobs).Values
	hasBackgroundWork := !slices.Contains(queues, None)
	if !hasBackgroundWork && len(notebooks) > 0 && len(notebooks) >= len(scripts) {
		return shape("notebook", High,
			fmt.Sprintf("%d notebook(s), including %s", len(notebooks), notebooks[0]))
	}

	// The framework detector already said why this builds to files, whether that
	// was a generator in the manifest, a build configured to export, a
	// generator's own configuration file, or HTML checked in. Repeating its
	// reasoning here got it wrong: it named an index.html that a generated site
	// does not have, and printed "undefined" when there was none to name.
	if isStatic {
		evidence := detected.Evidence
		if evidence == "" {
			evidence = "this repository builds to files"
		}
		return shape("static", High, evidence)
	}

	// Not every application is a process somebody starts. A PHP page and a CGI
	// script are run by a web server when a request arrives, which is why neither
	// declares a framework or opens a port. This is checked before the packaging
	// questions below because those read manifests, and repositories built this
	// way usually have none at all.
	if served := ServerExecutedSource(r); served != "" {
		return shape("service", High, served)
	}

	if commandLine := commandLineEntry(r); commandLine != "" {
		return shape("cli", High, commandLine)
	}

	if published := publishedLibrary(r); published != "" {
		return shape("library", Medium, published)
	}

	// A platform manifest states what runs as plainly as a framework dependency
	// does. A Procfile's web process is the one the platform routes HTTP traffic
	// to, and every platform that reads a Procfile keeps it running. Repositories
	// whose whole content is the deployment are common, and answering "we could
	// not tell what this runs" about a file that names the process is a failure
	// to read the one thing the author wrote down.
	if declaredWeb := webProcess(r); declaredWeb != "" {
		return shape("service", High, declaredWeb)
	}

	// No code of its own, and a compose file pinning somebody else's image: this
	// repository is not the application, it is the deployment of one. The
	// serverless detector already reads the same fact to rule out a function
	// tier, and shape was the half still saying it could not tell.
	deployed := DeployedImages(r)
	if len(deployed) > 0 && len(hostBoundServices(r)) == 0 {
		return shape("service", High,
			"a compose file runs "+strings.Join(deployed, ", ")+" from a prebuilt image")
	}

	// Not every hosted process answers an HTTP request. A dependency that holds
	// a connection open is a process somebody is already paying to keep alive: a
	// chat bot logs in once and stays logged in for as long as it runs. There is
	// no framework in its manifest and no port to serve on, and saying "we could
	// not tell" hid a server that plainly exists.
	//
	// The same fact is read again by the serverless detector, which is what keeps
	// this off a function tier. Calling it a service without that would quote $0
	// for something a function tier cannot host at all.
	if held := RuntimeMatching(r, PersistentConnection); len(held) > 0 {
		return shape("service", High,
			strings.Join(held, ", ")+" holds a connection open for the life of the process")
	}

	// The same question asked of the code, for the repositories whose manifest
	// does not answer it. A program that serves a websocket, or that opens a
	// socket and accepts connections on it, is being connected to by somebody.
	if inSource := HeldOpenInSource(r); inSource != "" {
		return shape("service", High, inSource)
	}

	// And of the file that packages it. A port in a Dockerfile is the author
	// saying the process inside listens, which is the plainest statement a
	// repository makes about being hosted. It is read before the batch runtime
	// below on purpose: a repository holding both a crawler and the daemon that
	// supervises it is the daemon, and the exposed port is which of the two is
	// the thing you run.
	if exposed := ExposedPort(r); exposed != "" {
		return shape("service", Medium, exposed)
	}

	// A batch runtime is the opposite: it starts, works, and stops. That is a
	// program you run, not a service you host, whatever else is in the manifest.
	if batch := RuntimeMatching(r, LongRunningBatch); len(batch) > 0 {
		return shape("script", High,
			strings.Join(batch, ", ")+" runs a batch job rather than serving requests")
	}

	// A scheduler in the process is the other kind of program that has to be left
	// running. Nothing connects to it, so it is not a service; it is a script
	// whose timing dies with it. Saying "we could not tell" about a program whose
	// whole design is "start it and walk away" was the wrong answer, and calling
	// it a service would have priced it as one.
	if scheduled := RuntimeMatching(r, InProcessScheduler); len(scheduled) > 0 {
		return shape("script", High, strings.Join(scheduled, ", ")+
			" keeps the schedule inside the process, so the program runs on rather than being triggered")
	}

	// Languages that declare no entry point in their manifest state it in what
	// they build instead, so this is asked last: after a framework, after a held
	// connection, after a batch runtime. Everything above is a process somebody
	// hosts, and a repository that ships a binary can be either.
	if program := commandLineProgram(r); program != "" {
		return shape("cli", High, program)
	}

	// Data that outnumbers the code makes the data the deliverable and the code a
	// helper that keeps it honest. An open dataset with one standard library
	// validator CI runs on every pull request is not a thing anybody hosts, and
	// calling it a script quoted a free function tier for a file that is never
	// called from outside the repository.
	//
	// Strictly outnumbers, on purpose. One fixture next to one script is a script
	// with a fixture, and this should say nothing about it.
	//
	// Asked before the manifest below, because whether the data is the point does
	// not depend on whether somebody wrote down a dependency.
	data := r.WithExtension(dataExtensions...)
	if len(scripts) > 0 && len(data) > len(scripts) {
		return shape("unknown", Low, fmt.Sprintf(
			"%d data file(s) against %d source file(s), so the deliverable here looks like the data rather than the code",
			len(data), len(scripts)))
	}

	// Code that says where it starts is a program. No framework named this
	// repository, but a module written to be run is not an open question: it is
	// something somebody runs, and the only thing left to settle is whether it
	// needs a process of its own, which the serverless detector answers on the
	// same evidence.
	if entry := programEntryPoint(r); entry != "" {
		return shape("script", Medium, entry)
	}

	// A project that declares dependencies has been set up to run as something,
	// and if none of them is a framework this tool knows, the honest answer is
	// that it could not tell. Calling it a script instead would route it to the
	// free function tier and quote $0, which is confidently wrong in the
	// direction that costs the owner money.
	if declared := DeclaredDependencies(r); len(declared) > 0 {
		return shape("unknown", Low, fmt.Sprintf(
			"%s declares %d dependencies, none of them a framework this tool recognizes",
			strings.Join(ManifestFiles(r), ", "), len(declared)))
	}

	// No declared dependencies at all, so loose source files really are loose.
	if len(scripts) > 0 {
		return shape("script", Medium,
			fmt.Sprintf("%d source file(s), no manifest, and no web framework", len(scripts)))
	}

	// Nothing in the tree is a program, so the last place one can be is the
	// automation. A workflow that runs on a clock and carries its own commands is
	// the program: git scraping repositories are built this way, and the run
	// block finishes in seconds and leaves nothing behind. Checked here, below
	// every source file, because a repository with code in it is described by the
	// code and not by what CI does to it.
	if scheduledInCI := scheduledWorkflow(r); scheduledInCI != "" {
		return shape("script", Medium, scheduledInCI)
	}

	// Documents and nothing else. No manifest, no source, no generator: a
	// repository like this is prose, and prose is read where it sits or served
	// as files. Either way there is no process to pay for, which is the answer a
	// static site already gets.
	//
	// Markdown has to outnumber everything else for this to hold. Almost every
	// repository carries a README, and one of those speaks for its own project,
	// not for the repository around it.
	markdown := r.WithExtension(markdownExtensions...)
	if len(markdown) > len(r.Files)-len(markdown) {
		return shape("static", Medium, fmt.Sprintf(
			"%d markdown file(s) and nothing else this tool recognizes", len(markdown)))
	}

	return shape("unknown", Low, "no source files this tool recognizes")
}

func shape(value string, confidence Confidence, evidence string) []Signal {
	return []Signal{Found(FieldShape, confidence, evidence, value)}
}

// firstSignal picks one detector's finding out of what it returned. A detector
// that reported nothing for the field is read as an absence, so a caller never
// has to index an empty slice.
func firstSignal(signals []Signal, field Field) Signal {
	for _, signal := range signals {
		if signal.Field == field {
			return signal
		}
	}
	return Signal{Field: field, Values: []string{None}}
}

func hostBoundServices(r *Repo) []string {
	services := ComposeServices(r)
	if services == nil {
		return nil
	}
	return services.HostBound
}

var (
	procfilePath = regexp.MustCompile(`(^|/)Procfile(\.[^/]+)?$`)
	// The one process type every platform that reads a Procfile routes traffic
	// to. A worker line is background work, which the jobs detector answers, and
	// a release line runs once and exits.
	webProcessLine = regexp.MustCompile(`(?m)^\s*web\s*:\s*\S`)
)

// webProcess reports a declared web process: something is served, whatever is
// behind it.
func webProcess(r *Repo) string {
	for _, file := range r.Matching(procfilePath.MatchString) {
		if webProcessLine.MatchString(r.Read(file)) {
			return file + " declares a web process, which is the one a platform routes requests to"
		}
	}
	return ""
}

// programEntryPoint reports the first module written to be run rather than
// imported.
func programEntryPoint(r *Repo) string {
	for _, file := range r.WithExtension(".py") {
		if programEntry.MatchString(r.Read(file)) {
			return file + " declares a program entry point, and no framework serves requests"
		}
	}
	return ""
}

// scheduledWorkflow reports a workflow that fires on a schedule and runs
// commands of its own.
func scheduledWorkflow(r *Repo) string {
	// Unless the repository builds something. A Dockerfile is a description of an
	// artefact this repository produces, and a workflow that rebuilds it weekly
	// is publishing that artefact rather than being the program itself.
	if len(r.Matching(IsDockerfile)) > 0 {
		return ""
	}

	for _, file := range r.Matching(workflowPath.MatchString) {
		text := r.Read(file)
		if workflowSchedule.MatchString(text) && workflowRun.MatchString(text) {
			return file + " runs on a schedule, and its own steps are the only program here"
		}
	}
	return ""
}

// importSurface names the package.json keys that offer other code something to
// import. "main" is not on this list: npm init writes one into every
// package.json it creates, so it states nothing. These three are written down
// on purpose.
var importSurface = []string{"exports", "types", "typings"}

var consoleScript = regexp.MustCompile(`\[project\.scripts\]|console_scripts`)

// commandLineEntry reports a bin entry or a console script, which is a thing
// you install rather than a thing you host.
func commandLineEntry(r *Repo) string {
	for _, manifest := range NodeManifests(r) {
		if _, ok := manifest.Fields["bin"]; !ok {
			continue
		}
		// A package that declares an import surface as well as a command is a
		// library that ships a command with it. The command is a convenience; the
		// reason anybody adds the package to their dependencies is the API, and
		// the library rule below says so in the right words.
		if len(declaredKeys(manifest.Fields, importSurface)) > 0 {
			continue
		}
		return manifest.Path + " declares a bin entry"
	}
	for _, file := range PythonManifestFiles(r) {
		if consoleScript.MatchString(r.Read(file)) {
			return file + " declares a console script"
		}
	}
	return ""
}

// publishingIntent names the package.json keys that say a package is published
// rather than deployed.
//
// A "main" field on its own means nothing: "npm init -y" writes one into every
// package.json it creates. Calling that a library told the owner of a long
// running bot there was nothing to host. Something that is actually published
// says so in a second way, by declaring its exports, the files it ships, or how
// it should be published.
var publishingIntent = []string{"exports", "files", "publishConfig", "types", "typings"}

var (
	actionRuns    = regexp.MustCompile(`(?m)^runs:`)
	pythonProject = regexp.MustCompile(`(?m)^\[project\]`)
	pythonSetup   = regexp.MustCompile(`(?m)setuptools\.setup|^\s*setup\(`)
)

// publishedLibrary reports why this is packaged for other people to import, so
// that it is published rather than deployed.
func publishedLibrary(r *Repo) string {
	// A GitHub Action is referenced by other repositories and runs on their
	// runners. It carries a manifest and real dependencies, so it reads like an
	// application, but nothing about it is ever deployed from here. Only the root
	// file counts: an application may keep a composite action under .github/ and
	// that says nothing about the repository as a whole.
	for _, file := range []string{"action.yml", "action.yaml"} {
		if r.Has(file) && actionRuns.MatchString(r.Read(file)) {
			return file + " declares a GitHub Action, which runs on the caller's runner"
		}
	}

	for _, manifest := range NodeManifests(r) {
		if private, ok := manifest.Fields["private"].(bool); ok && private {
			continue
		}
		if declared := declaredKeys(manifest.Fields, publishingIntent); len(declared) > 0 {
			return fmt.Sprintf("%s declares %s for importers",
				manifest.Path, strings.Join(declared, " and "))
		}
	}
	for _, file := range PythonManifestFiles(r) {
		text := r.Read(file)
		if pythonProject.MatchString(text) || pythonSetup.MatchString(text) {
			return file + " packages this for distribution"
		}
	}

	// Go states this in the code rather than in the manifest: a module with no
	// main package builds no binary, so there is nothing to run and consumers
	// import it. Most Go libraries also declare no dependencies at all, which
	// used to leave them looking like a folder of loose scripts.
	modules := GoModFiles(r)
	sources := r.WithExtension(".go")
	if len(modules) > 0 && len(sources) > 0 && len(mainPackages(r, sources)) == 0 {
		return fmt.Sprintf("%s with no main package in %d Go file(s), so this is imported rather than run",
			modules[0], len(sources))
	}

	// Rust says the same thing in its manifest and its layout. A crate that
	// builds a library and no binary is linked into somebody else's program,
	// which is what a crate published to crates.io or wrapped up by wasm-pack is
	// for. Requiring the absence of a binary is the whole of it: a command line
	// tool commonly keeps its logic in src/lib.rs too, and that alone would have
	// called every one of them a library.
	if cargos := CargoFiles(r); len(cargos) > 0 && !buildsARustBinary(r, cargos[0]) {
		if rustLibraryTarget.MatchString(r.Read(cargos[0])) || r.Has("src/lib.rs") {
			return cargos[0] + " builds a library and no binary, so this is linked into other programs"
		}
	}

	// Infrastructure code and no application anywhere near it. A Terraform module
	// and a chart repository are both packages: other repositories reference them
	// by source and install them, and nothing is deployed from here. The
	// discriminator is that there is no application to deploy. The moment a
	// repository holds both the code and the files that deploy it, those files
	// describe that deployment and this does not apply.
	nothingToDeploy := len(ManifestFiles(r)) == 0 && len(r.WithExtension(scriptExtensions...)) == 0
	if nothingToDeploy && len(r.Matching(infrastructurePackage.MatchString)) > 0 {
		return "infrastructure code with no application source and no dependency manifest, so the module is the deliverable"
	}

	// The same argument for a container image, with one more thing required of
	// it. A Dockerfile on its own proves nothing: most repositories that carry
	// one carry it because that is how their application ships, and a Dockerfile
	// with nothing beside it is an incomplete repository rather than a package.
	// What makes the image the deliverable is a build that pushes it to a
	// registry with no application of its own anywhere near it. Other
	// repositories then write FROM and consume it exactly as they consume a
	// package, which is publication in the sense every other branch here means.
	//
	// Only a Dockerfile at the root counts, for the reason the GitHub Action
	// above is read only at the root: an application may keep one in a
	// subdirectory and that says nothing about the repository as a whole.
	if nothingToDeploy && r.Has("Dockerfile") {
		for _, file := range r.Files {
			if ciConfigPath.MatchString(file) && pushesAnImage.MatchString(r.Read(file)) {
				return file + " pushes the image Dockerfile builds, and there is no application here to deploy"
			}
		}
	}

	return ""
}

// declaredKeys returns the keys a manifest actually declares, in the order they
// were asked for.
func declaredKeys(fields map[string]any, keys []string) []string {
	var declared []string
	for _, key := range keys {
		if _, ok := fields[key]; ok {
			declared = append(declared, key)
		}
	}
	return declared
}

func mainPackages(r *Repo, sources []string) []string {
	var mains []string
	for _, file := range sources {
		if goMainPackage.MatchString(r.Read(file)) {
			mains = append(mains, file)
		}
	}
	return mains
}

func buildsARustBinary(r *Repo, cargo string) bool {
	return rustBinaryTarget.MatchString(r.Read(cargo)) ||
		len(r.Matching(rustBinarySource.MatchString)) > 0
}

// ArgumentParsers holds the libraries whose whole purpose is to turn argv into
// a program's options.
//
// A dependency on one of these is a repository saying, in its manifest, that a
// person types this name and some words after it. No service needs one to be
// reached.
var ArgumentParsers = map[string]bool{
	// Rust
	"clap": true, "structopt": true, "argh": true, "gumdrop": true,
	"pico-args": true, "lexopt": true, "bpaf": true,
	// Go, matched on the normalised segments GoDependencies produces
	"cobra": true, "urfave": true, "kingpin": true, "pflag": true, "go-flags": true,
	// Python
	"click": true, "typer": true, "docopt": true,
	// Node
	"commander": true, "yargs": true, "cac": true, "meow": true, "@oclif/core": true,
	// Ruby
	"thor": true, "gli": true,
}

var (
	// The same thing said with the standard library instead of a dependency.
	// os.Args and sys.argv are the plainest way a program reads its command line,
	// and a tool that hand rolls its parsing uses nothing else. Leaving them out
	// missed every command line program that did not reach for a library, which
	// includes this one.
	standardArgumentParsing = regexp.MustCompile(`\bflag\.(Parse|Args?|String|Int|Int64|Bool|Float64|Duration|Var)\(|\bos\.Args\b|\bsys\.argv\b|\benv::args\b|\bArgumentParser\(|\bgetopts?\b`)

	// A call that opens a listening socket.
	//
	// A process that waits for connections is hosted, not installed, whatever it
	// read off its own command line on the way up. A metrics exporter takes
	// --listen from argv and is still a process somebody keeps running, and
	// without this every daemon that accepts a flag would read as a tool you
	// download.
	listensForConnections = regexp.MustCompile(`\bListenAndServe(TLS)?\(|\bnet\.Listen\(|\bTcpListener::bind\(|\bHttpServer::new\(|\bserve_forever\(|\.listen\(`)
)

// executable is what this repository builds or ships that a person could run.
type executable struct {
	// files are the sources that are the program's own entry point.
	files    []string
	evidence string
}

// commandLineProgram reports a program somebody installs and runs from a shell.
//
// Two independent things have to be true, because either alone is worthless.
// The repository has to ship something executable, and that executable has to
// be driven from a command line. Every web service compiles to a binary too, so
// "this builds a binary" identifies nothing on its own; and a repository full
// of argument parsing with nothing to install is a library of helpers.
//
// Said that way it holds across languages that declare it very differently: a
// Cargo binary target with clap, a Go main package that calls flag.Parse, a
// directory of shell programs a Makefile copies onto a PATH. Node and Python
// are already answered earlier and more directly, by the bin field and the
// console script entry point their manifests carry.
func commandLineProgram(r *Repo) string {
	program := executableProgram(r)
	if program == nil {
		return ""
	}
	for _, file := range program.files {
		if listensForConnections.MatchString(r.Read(file)) {
			return ""
		}
	}
	if shipsAsARunningProcess(r) {
		return ""
	}

	driven := commandLineInterface(r, program.files)
	if driven == "" {
		return ""
	}
	return program.evidence + ", and " + driven
}

// shipsAsARunningProcess reports whether the repository also says how to keep
// this thing running somewhere.
//
// Nobody writes a Deployment for a program people install on their laptops.
// A binary that arrives with an image to run it, a compose file, or a chart is
// a process its owner runs, however many flags it accepts on the way up: a
// queue consumer takes --brokers and is still a daemon.
//
// Falling silent here costs a command line tool that happens to publish an
// image nothing but the answer it already got, "we could not tell". Getting it
// wrong the other way tells the owner of a running process there is nothing to
// host, which is the expensive direction.
func shipsAsARunningProcess(r *Repo) bool {
	container := firstSignal(DetectContainer(r), FieldContainer).Values
	orchestration := firstSignal(DetectOrchestration(r), FieldOrchestration).Values
	return !slices.Contains(container, None) || !slices.Contains(orchestration, None)
}

func executableProgram(r *Repo) *executable {
	if cargos := CargoFiles(r); len(cargos) > 0 && buildsARustBinary(r, cargos[0]) {
		sources := r.Matching(rustBinarySource.MatchString)
		if rustBinaryTarget.MatchString(r.Read(cargos[0])) {
			return &executable{files: sources, evidence: cargos[0] + " declares a binary target"}
		}
		// Without a [[bin]] section the only way buildsARustBinary was true is
		// that cargo found a binary source, so there is one to name.
		return &executable{files: sources, evidence: fmt.Sprintf(
			"%s and %s, which cargo builds as a binary", cargos[0], sources[0])}
	}

	if modules := GoModFiles(r); len(modules) > 0 {
		if mains := mainPackages(r, r.WithExtension(".go")); len(mains) > 0 {
			return &executable{files: mains, evidence: fmt.Sprintf(
				"%s with a main package in %s, which builds a binary", modules[0], mains[0])}
		}
	}

	// Nothing compiles here: the file that is checked in is the program. A
	// shebang says it runs on its own, and the directory says it is meant for
	// somebody's PATH rather than being a helper the build calls.
	var shipped []string
	for _, file := range r.Matching(programDirectory.MatchString) {
		if strings.HasPrefix(r.Read(file), "#!") {
			shipped = append(shipped, file)
		}
	}
	if len(shipped) > 0 {
		return &executable{files: shipped, evidence: fmt.Sprintf(
			"%d executable program(s) checked in, including %s", len(shipped), shipped[0])}
	}

	return nil
}

// commandLineInterface reports the evidence that the program above is driven by
// what a person types after it.
func commandLineInterface(r *Repo, sources []string) string {
	var parsers []string
	for name := range DeclaredDependencies(r) {
		if ArgumentParsers[name] {
			parsers = append(parsers, name)
		}
	}
	sort.Strings(parsers)
	if len(parsers) > 0 {
		return strings.Join(parsers, ", ") + " parses its command line"
	}

	for _, file := range sources {
		if standardArgumentParsing.MatchString(r.Read(file)) {
			return file + " reads its own arguments"
		}
	}

	return installsOntoPath(r)
}

var (
	installTarget   = regexp.MustCompile(`(?m)^install:.*\n((?:[ \t]+\S.*\n?)*)`)
	installsIntoBin = regexp.MustCompile(`\bbin\b`)
)

// installsOntoPath reports an install target that writes into a directory
// called bin.
//
// That is the plainest statement a repository can make that what it produces
// belongs on somebody's PATH. It is deliberately not "has an install target":
// half the projects on earth have one that installs their dependencies, and
// where it writes is what separates the two.
func installsOntoPath(r *Repo) string {
	for _, file := range r.Matching(makefilePath.MatchString) {
		recipe := installTarget.FindStringSubmatch(r.Read(file))
		if recipe != nil && installsIntoBin.MatchString(recipe[1]) {
			return file + " installs into a bin directory, so this belongs on a PATH"
		}
	}
	return ""
}
