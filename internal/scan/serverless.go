package scan

import (
	"regexp"
	"sort"
	"strings"
)

// Blocker is a reason a repository cannot run on a free function tier.
//
// The set is closed. Rules match on these strings, so declaring them as
// constants rather than writing them out at each use turns a typo into a
// compile error instead of a rule that quietly never fires.
type Blocker string

const (
	// BlockedByBackgroundWork is work the application already does outside the
	// request cycle, which needs a process that keeps running.
	BlockedByBackgroundWork Blocker = "background_work"
	// BlockedByHeldConnections is a connection held open for longer than one
	// request, whether a dependency or this repository's own code holds it.
	BlockedByHeldConnections Blocker = "held_connections"
	// BlockedByInProcessSchedule is a schedule that only happens while the
	// process it lives in is running.
	BlockedByInProcessSchedule Blocker = "in_process_schedule"
	// BlockedByLongRunning is one run that takes longer than a function tier
	// allows.
	BlockedByLongRunning Blocker = "long_running"
	// BlockedByModelRuntime is a runtime whose size is set by a model file, so
	// no price can be given without seeing the model.
	BlockedByModelRuntime Blocker = "model_runtime"
	// BlockedByHeavyRuntime is a runtime too large to cold start, but sized by
	// ordinary things, so the next rung down has a price.
	BlockedByHeavyRuntime Blocker = "heavy_runtime"
	// BlockedByNoFreeTierRuntime is a language the free managed tiers do not
	// run at all.
	BlockedByNoFreeTierRuntime Blocker = "no_free_tier_runtime"
	// BlockedByServerExecuted is source a web server executes per request, and
	// a function tier gives you no web server to configure.
	BlockedByServerExecuted Blocker = "server_executed"
	// BlockedByPrebuiltImage is a deployment of somebody else's container,
	// which stays up rather than being invoked.
	BlockedByPrebuiltImage Blocker = "prebuilt_image"
	// BlockedByLocalDisk is state in a file, which needs a disk that persists.
	BlockedByLocalDisk Blocker = "local_disk"
)

// Blockers is every reason this detector can give, in the order DetectServerless
// tests for them. Exported so a test can walk the closed set exhaustively
// rather than trusting that the strings in rules/ and the strings here agree.
var Blockers = []Blocker{
	BlockedByBackgroundWork,
	BlockedByHeldConnections,
	BlockedByInProcessSchedule,
	BlockedByLongRunning,
	BlockedByModelRuntime,
	BlockedByHeavyRuntime,
	BlockedByNoFreeTierRuntime,
	BlockedByServerExecuted,
	BlockedByPrebuiltImage,
	BlockedByLocalDisk,
}

// PersistentConnection holds the dependencies that need a process which
// outlives a request.
//
// The test for membership is one question: does this library exist to hold a
// network connection open for the life of the process? A bot opens one gateway
// connection at startup and holds it until it stops; nothing routes a request
// to it, and there is no version of that which fits in a function invocation.
// The same is true of a websocket transport, a peer to peer node, a watch on
// somebody else's API, and a dashboard server that keeps each open tab's state
// behind a socket.
//
// It is not a list of libraries that are merely slow, large, or asynchronous.
// Those are different findings with different answers, and they have their own
// sets below.
var PersistentConnection = map[string]bool{
	// Websocket and long poll transports. The connection is the product.
	"socket.io":      true,
	"ws":             true,
	"uwebsockets.js": true,
	// gorilla/websocket and nhooyr.io/websocket both normalise to this segment.
	"websocket":          true,
	"websockets":         true,
	"websocket-client":   true,
	"express-ws":         true,
	"@fastify/websocket": true,
	"channels":           true,
	"django-channels":    true,
	"actioncable":        true,
	"faye":               true,
	"pusher":             true,
	"centrifuge":         true,

	// Chat and protocol gateways. One login at startup, held until the process
	// stops, with the far end pushing whenever it likes.
	"discord.js":               true,
	"discord.py":               true,
	"discordpy":                true,
	"discordrb":                true,
	"nextcord":                 true,
	"disnake":                  true,
	"py-cord":                  true,
	"hikari":                   true,
	"telegraf":                 true,
	"grammy":                   true,
	"python-telegram-bot":      true,
	"pytelegrambotapi":         true,
	"aiogram":                  true,
	"telethon":                 true,
	"pyrogram":                 true,
	"@slack/bolt":              true,
	"@slack/socket-mode":       true,
	"slack-bolt":               true,
	"slack_bolt":               true,
	"irc":                      true,
	"cinch":                    true,
	"matrix-bot-sdk":           true,
	"matrix-appservice-bridge": true,
	"matrix-nio":               true,
	"@xmpp/client":             true,
	"slixmpp":                  true,
	"sleekxmpp":                true,

	// Peer to peer nodes. A node is only in the network while it is dialled in.
	"libp2p": true,

	// Watchers on somebody else's API. An operator or a controller holds a watch
	// stream open and reacts to what comes down it, which is a loop that never
	// returns rather than a request that is answered.
	"controller-runtime": true,
	"kopf":               true,

	// Dashboard servers that keep each session in the process behind a socket.
	// These are not request and response: closing the process drops every open
	// tab, and a second copy of it would not know what the first one was showing.
	"streamlit": true,
	"gradio":    true,
	"dash":      true,
	"panel":     true,
	"bokeh":     true,
	"voila":     true,
	"nicegui":   true,
	"solara":    true,
}

// InProcessScheduler holds the dependencies that put the schedule inside the
// process.
//
// A program with its own scheduler has to keep running for its timing to
// happen: there is no cron entry and nothing external wakes it. That rules out
// a free function tier for the same reason a held connection does.
//
// It says nothing about shape, though, and that is the point of keeping it
// apart. Nobody connects to a price watcher. It is still a script; it is a
// script that has to be left running, which is a cheaper answer than a service
// and an honest one.
var InProcessScheduler = map[string]bool{
	"apscheduler":    true,
	"schedule":       true,
	"rocketry":       true,
	"node-cron":      true,
	"node-schedule":  true,
	"toad-scheduler": true,
	"croner":         true,
	// The npm package and robfig/cron, which normalises to this segment.
	"cron":            true,
	"gocron":          true,
	"rufus-scheduler": true,
	"clockwork":       true,
}

// LongRunningBatch holds the dependencies that describe a batch program rather
// than a service.
//
// A crawl runs for as long as it takes, which is minutes or hours once a
// politeness delay is in it. Free function tiers stop well short of that, so
// this rules out the same tier a held connection does, for the opposite reason:
// not a process that never ends, but one run that takes too long.
var LongRunningBatch = map[string]bool{
	"scrapy":  true,
	"crawlee": true,
	"apify":   true,
}

// ModelRuntime holds the dependencies whose size is set by a model file rather
// than by traffic.
//
// Kept apart from the merely heavy because the two lead to different answers.
// A model decides how much memory the process needs and whether it needs a GPU
// at all, and none of that can be read out of a repository, so the honest reply
// is to give no price. "Too big for a function" is a different statement, and
// one small server answers it.
var ModelRuntime = map[string]bool{
	"torch":                 true,
	"pytorch":               true,
	"tensorflow":            true,
	"keras":                 true,
	"transformers":          true,
	"sentence-transformers": true,
	"diffusers":             true,
	"accelerate":            true,
	"jax":                   true,
	"onnxruntime":           true,
	"onnxruntime-gpu":       true,
	"vllm":                  true,
	"llama-cpp-python":      true,
	"ctransformers":         true,
	"openai-whisper":        true,
	"whisper":               true,
	"faster-whisper":        true,
	"whisperx":              true,
	"spacy":                 true,
	"ultralytics":           true,
}

// HeavyRuntime holds the dependencies too large or too slow to start inside a
// free function tier.
//
// Heavy, but sized by ordinary things: a headless browser, a video encoder, a
// numerical library. Any of them runs on a small always on server, so the price
// is knowable and the ordinary stage rules give it.
//
// The classical machine learning libraries belong here rather than above. What
// a fitted scikit-learn or gradient boosting model loads is a table of
// coefficients or a few hundred trees: it runs on a CPU, and the smallest
// servers hold it. They rule out a free function tier on size alone, which is
// a statement about the machine and not about a model nobody can see, so the
// ordinary rules can and should put a price on them.
var HeavyRuntime = map[string]bool{
	"scikit-learn":           true,
	"sklearn":                true,
	"xgboost":                true,
	"lightgbm":               true,
	"opencv-python":          true,
	"opencv-python-headless": true,
	"scipy":                  true,
	"playwright":             true,
	"playwright-core":        true,
	"puppeteer":              true,
	"puppeteer-core":         true,
	"selenium":               true,
	"ffmpeg":                 true,
	"ffmpeg-python":          true,
	"fluent-ffmpeg":          true,
}

// NoFreeTierRuntime holds the languages the free managed tiers do not run.
//
// The free plans this tool prices against, Cloudflare Workers and Vercel's
// Hobby plan, run JavaScript and Python. None of them takes a PHP application,
// a JVM service, a BEAM release or a .NET service, so "a free tier covers this"
// is not an answer available to these at any traffic level. What they need is a
// process on a machine of their own, which is the next rung down and a price
// this tool can give.
//
// This is about where the code can run, not about the language.
var NoFreeTierRuntime = map[string]bool{
	"php":    true,
	"java":   true,
	"elixir": true,
	"dotnet": true,
}

// RuntimeMatching returns the production dependencies that fall in one of the
// sets above.
//
// Exported because two of these sets answer a shape question as well as a
// hosting one, and the shape detector has to read them the same way this file
// does: production dependencies only, so a test runner never decides what a
// repository is.
func RuntimeMatching(repo *Repo, names map[string]bool) []string {
	return dependenciesIn(RuntimeDependencies(repo), names)
}

func dependenciesIn(dependencies, names map[string]bool) []string {
	var found []string
	for name := range dependencies {
		if names[name] {
			found = append(found, name)
		}
	}
	sort.Strings(found)
	return found
}

// Source files that say how a program starts. Scanning them is the expensive
// path, so it is bounded the same way the database detector bounds its own,
// with the same constant.
var programSource = regexp.MustCompile(`\.(py|[cm]?[jt]sx?|rb|go|rs|java|kt|exs?|php)$`)

// Tests, in every naming convention that matters. A test opens a socket to
// exercise something else and closes it again, so it describes no deployment of
// its own. This is the reasoning the walker already applies to fixtures and
// examples, applied here to the files those conventions leave in place.
var testSource = regexp.MustCompile(`(^|/)(tests?|specs?|__tests__)/|\.(test|spec)\.[^/]+$|_test\.[^/]+$|_spec\.[^/]+$|(^|/)test_[^/]+$`)

// A string delimiter in any of the three spellings JavaScript allows, written
// as a constant because a Go raw string literal cannot hold a backtick.
const quoteCharacter = "[\"'`]"

// How each ecosystem spells "serve a websocket".
//
// A websocket endpoint is a connection this process holds for as long as the
// client is on the other end of it, which is the same finding a websocket
// dependency gives, read out of the code instead of the manifest. It is worth
// reading separately because the transport is often built into the framework:
// Bun, Deno and Elysia declare a socket route with no dependency to name.
var servesWebsockets = regexp.MustCompile(
	`\bnew\s+websocket(?:server|\.server)\s*\(` +
		`|\bupgrader\.upgrade\s*\(` +
		`|\bwebsocket\.accept\s*\(` +
		`|\.ws\s*\(\s*` + quoteCharacter + `/` +
		`|@\w+\.websocket\s*\(` +
		`|\bwebsocket_urlpatterns\b` +
		`|\bio\.on\s*\(\s*` + quoteCharacter + `connection` + quoteCharacter)

// A socket the program listens on and accepts connections from itself.
//
// Both halves are required, and together they mean something an HTTP server
// does not do: this code owns the socket and speaks its own protocol over it.
// A framework that calls net.Listen and hands the listener to an HTTP server
// never calls Accept, so it does not match. Nothing that owns a socket can run
// on a function tier, which delivers a request to a handler and never a
// connection.
var (
	opensAListener     = regexp.MustCompile(`\bnet\.listen\s*\(|\btcplistener::bind\s*\(|\btcpserver\.new\s*\(|\bsocket\.socket\s*\(|\bnew\s+serversocket\s*\(`)
	acceptsConnections = regexp.MustCompile(`\.accept\s*\(\s*\)|\.incoming\s*\(\s*\)`)
)

// HeldOpenInSource returns a connection this repository's own code holds open,
// as one sentence naming the file it was read from, or "" when there is none.
//
// Exported because the same fact answers two questions: whether there is
// something to host here at all, and whether a function tier could host it.
// Both have to read it the same way, which is why neither reads it alone.
func HeldOpenInSource(repo *Repo) string {
	sources := repo.Matching(func(path string) bool {
		return programSource.MatchString(path) && !testSource.MatchString(path)
	})
	for _, file := range firstN(sources, maxSourceFilesScanned) {
		// Matched against lowercased source. Every ecosystem capitalises these
		// names differently, and the answer does not depend on which one this is.
		text := strings.ToLower(repo.Read(file))
		if servesWebsockets.MatchString(text) {
			return file + " serves a websocket, which is a connection held open for as long as the client is there"
		}
		if opensAListener.MatchString(text) && acceptsConnections.MatchString(text) {
			return file + " listens on a socket and accepts connections itself, so it speaks its own protocol rather than answering requests"
		}
	}
	return ""
}

// A PHP page that touches the request is answering one. Nothing else in the
// file says so: there is no main, no listen call, and usually no manifest.
var phpRequest = regexp.MustCompile(`\$_(GET|POST|REQUEST|SERVER|SESSION|COOKIE|FILES)\b|\bheader\s*\(\s*["']`)

var (
	cgiSource = regexp.MustCompile(`\.(cgi|pl)$`)
	cgiBin    = regexp.MustCompile(`(^|/)cgi-bin/`)
	// Server configuration that hands a request to a program instead of
	// returning a file. Read only from files that are server configuration, so
	// this stays a handful of reads rather than a scan of the repository.
	serverConfig = regexp.MustCompile(`(^|/)(\.htaccess|[^/]+\.conf)$`)
	cgiHandler   = regexp.MustCompile(`ScriptAlias|AddHandler\s+cgi-script|SetHandler\s+cgi-script|Options\s+\+?ExecCGI`)
)

// ServerExecutedSource returns source a web server executes, rather than a
// process anybody starts, as one sentence, or "" when there is none.
//
// A PHP page under a document root and a CGI script under a ScriptAlias are
// both applications with no main function, no port of their own, and often no
// dependency manifest. The web server receives a request and runs the file.
// That is how a great deal of the web is still built, and a repository full of
// those files is plainly something you host even though every signal this tool
// usually reads is missing.
//
// It is read here rather than in the shape detector because it answers two
// questions at once, the way a held connection does: what this repository is,
// and why no free function tier will take it. A function tier sells an
// invocation, not a web server configured to execute your files.
func ServerExecutedSource(repo *Repo) string {
	for _, file := range firstN(repo.Matching(phpSource.MatchString), maxSourceFilesScanned) {
		if phpRequest.MatchString(repo.Read(file)) {
			return file + " reads the request directly, so a web server runs it per request"
		}
	}

	scripts := repo.Matching(cgiSource.MatchString)
	for _, file := range scripts {
		if cgiBin.MatchString(file) {
			return file + " sits under cgi-bin, which a web server executes per request"
		}
	}

	if len(scripts) > 0 {
		for _, file := range firstN(repo.Matching(serverConfig.MatchString), maxSourceFilesScanned) {
			if cgiHandler.MatchString(repo.Read(file)) {
				return file + " configures a web server to execute " + scripts[0]
			}
		}
	}

	return ""
}

// DetectServerless reports whether this could run on a serverless or managed
// free tier, and if not, what stops it.
//
// The question a founder actually has is "can I put this somewhere free before
// I start paying for a box". Something blocks that answer only when the code
// needs a process that stays alive: background work, held open connections,
// a database file it writes on local disk, or a runtime too heavy to cold
// start. Absent all four, a free function tier covers it.
func DetectServerless(repo *Repo) []Signal {
	var blockers []string
	var kinds []Blocker

	block := func(kind Blocker, sentence string) {
		blockers = append(blockers, sentence)
		kinds = append(kinds, kind)
	}

	jobs := DetectJobs(repo)[0].Values
	if !contains(jobs, None) {
		block(BlockedByBackgroundWork, "background work ("+strings.Join(jobs, ", ")+") needs a process that keeps running")
	}

	// Judged on production dependencies only. A test runner or a build tool does
	// not run when a request arrives, so it cannot be what stops this fitting.
	dependencies := RuntimeDependencies(repo)

	held := dependenciesIn(dependencies, PersistentConnection)
	if len(held) > 0 {
		block(BlockedByHeldConnections, strings.Join(held, ", ")+" holds connections open")
	}

	// The same finding read out of the code. A repository can hold a connection
	// open with nothing in its manifest to say so, because the transport came
	// with the runtime or the socket is opened by hand.
	if len(held) == 0 {
		if inSource := HeldOpenInSource(repo); inSource != "" {
			block(BlockedByHeldConnections, inSource)
		}
	}

	if scheduled := dependenciesIn(dependencies, InProcessScheduler); len(scheduled) > 0 {
		block(BlockedByInProcessSchedule, strings.Join(scheduled, ", ")+" keeps the schedule inside the process, so it only runs while the process does")
	}

	if batch := dependenciesIn(dependencies, LongRunningBatch); len(batch) > 0 {
		block(BlockedByLongRunning, strings.Join(batch, ", ")+" runs for longer than a function tier allows")
	}

	if models := dependenciesIn(dependencies, ModelRuntime); len(models) > 0 {
		block(BlockedByModelRuntime, strings.Join(models, ", ")+" loads a model, and the model sizes the machine")
	}

	if heavy := dependenciesIn(dependencies, HeavyRuntime); len(heavy) > 0 {
		block(BlockedByHeavyRuntime, strings.Join(heavy, ", ")+" is too large to cold start in a free function tier")
	}

	// The runtime itself can be what rules the free tier out. This is read from
	// the manifest, so it is the same class of evidence as the rest.
	var unsupported []string
	for _, signal := range DetectFramework(repo) {
		if signal.Field != FieldLanguage {
			continue
		}
		for _, language := range signal.Values {
			if NoFreeTierRuntime[language] {
				unsupported = append(unsupported, language)
			}
		}
		break
	}
	if len(unsupported) > 0 {
		sort.Strings(unsupported)
		block(BlockedByNoFreeTierRuntime, "the free managed tiers do not run "+strings.Join(unsupported, ", "))
	}

	// Files a web server executes need a web server. A function tier sells an
	// invocation and gives you nowhere to configure one.
	if served := ServerExecutedSource(repo); served != "" {
		block(BlockedByServerExecuted, served+", and a free function tier has no web server to configure")
	}

	// A repository that holds no code of its own, and a compose file pinning
	// somebody else's image, is a deployment. What it deploys is a container that
	// stays up, which is not a thing a function tier sells.
	if deployed := DeployedImages(repo); len(deployed) > 0 {
		block(BlockedByPrebuiltImage, "a compose file runs "+strings.Join(deployed, ", ")+" from a prebuilt image")
	}

	// A file database is written to local disk, which a function does not keep.
	if contains(DetectDatabase(repo)[0].Values, "sqlite") {
		block(BlockedByLocalDisk, "a single file database has to live on a disk that persists")
	}

	if len(blockers) > 0 {
		evidence := strings.Join(blockers, "; ")
		reasons := make([]string, 0, len(kinds))
		for _, kind := range kinds {
			reasons = append(reasons, string(kind))
		}
		return []Signal{
			Found(FieldServerlessFit, High, evidence, "blocked"),
			// Why it is blocked decides the answer. A queue needs a cheap always
			// on box; a machine learning runtime needs a machine chosen for the
			// model, which is a different question at a different price.
			Found(FieldBlockedBy, High, evidence, reasons...),
		}
	}

	evidence := "nothing here needs a process that outlives a request: no background work, no held connections, no local disk state"
	return []Signal{
		Found(FieldServerlessFit, Medium, evidence, "fits"),
		Absent(FieldBlockedBy, Medium, evidence),
	}
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
