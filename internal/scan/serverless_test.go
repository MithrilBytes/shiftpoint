package scan

import (
	"slices"
	"strings"
	"testing"
)

func TestServerlessFitsWhenNothingOutlivesARequest(t *testing.T) {
	repo := build(t, map[string]string{"package.json": `{"dependencies":{"express":"^4"}}`})

	signals := DetectServerless(repo)
	if len(signals) != 2 {
		t.Fatalf("got %d signals, want a fit and a reason", len(signals))
	}
	if signals[0].Field != FieldServerlessFit || !slices.Equal(signals[0].Values, []string{"fits"}) {
		t.Errorf("got %v %v, want serverless_fit [fits]", signals[0].Field, signals[0].Values)
	}
	if signals[1].Field != FieldBlockedBy || !slices.Equal(signals[1].Values, []string{None}) {
		t.Errorf("got %v %v, want blocked_by [none]", signals[1].Field, signals[1].Values)
	}
	// A fit is the weaker claim of the two: it rests on nothing having turned
	// up, and there is always somewhere left unread.
	if signals[0].Confidence != Medium {
		t.Errorf("got %v, want medium", signals[0].Confidence)
	}
}

func TestServerlessNamesWhatStopsIt(t *testing.T) {
	cases := []struct {
		name     string
		files    map[string]string
		want     []Blocker
		evidence string
	}{
		{
			name:     "background work needs a process that keeps running",
			files:    map[string]string{"Gemfile": "gem \"sidekiq\"\n"},
			want:     []Blocker{BlockedByBackgroundWork},
			evidence: "keeps running",
		},
		{
			name:     "a dependency that holds connections open",
			files:    map[string]string{"package.json": `{"dependencies":{"socket.io":"^4"}}`},
			want:     []Blocker{BlockedByHeldConnections},
			evidence: "holds connections open",
		},
		{
			// The transport often comes with the runtime, so there is no
			// dependency to name and the code is the only place it is written.
			name:     "a connection this repository's own code holds open",
			files:    map[string]string{"server.ts": "const wss = new WebSocketServer({ port: 8080 });"},
			want:     []Blocker{BlockedByHeldConnections},
			evidence: "serves a websocket",
		},
		{
			name:     "a schedule that lives inside the process",
			files:    map[string]string{"requirements.txt": "APScheduler==3.10.4\n"},
			want:     []Blocker{BlockedByInProcessSchedule},
			evidence: "only runs while the process does",
		},
		{
			name:     "one run that takes longer than a function tier allows",
			files:    map[string]string{"requirements.txt": "Scrapy==2.11.2\n"},
			want:     []Blocker{BlockedByLongRunning},
			evidence: "runs for longer",
		},
		{
			// Both are too big for a function tier, and that is where the likeness
			// ends. A model decides the machine; a headless browser just needs one.
			name:     "a model that sizes the machine",
			files:    map[string]string{"requirements.txt": "torch==2.3.0\n"},
			want:     []Blocker{BlockedByModelRuntime},
			evidence: "sizes the machine",
		},
		{
			name:     "a runtime too heavy to cold start",
			files:    map[string]string{"requirements.txt": "playwright==1.45.0\n"},
			want:     []Blocker{BlockedByHeavyRuntime},
			evidence: "cold start",
		},
		{
			name:     "a language the free managed tiers do not run",
			files:    map[string]string{"composer.json": `{"require":{"laravel/framework":"^11"}}`},
			want:     []Blocker{BlockedByNoFreeTierRuntime},
			evidence: "the free managed tiers do not run php",
		},
		{
			// A function tier sells an invocation and gives you nowhere to
			// configure a web server.
			name:     "source a web server executes per request",
			files:    map[string]string{"index.php": "<?php echo $_GET['name'];"},
			want:     []Blocker{BlockedByServerExecuted},
			evidence: "no web server to configure",
		},
		{
			name: "a compose file deploying somebody else's image",
			files: map[string]string{
				"docker-compose.yml": "services:\n  app:\n    image: ghcr.io/acme/thing:1\n  db:\n    image: postgres:16\n",
			},
			want:     []Blocker{BlockedByPrebuiltImage},
			evidence: "prebuilt image",
		},
		{
			name: "a single file database that has to survive the request",
			files: map[string]string{
				"requirements.txt": "Flask==3.0.3\n",
				"app.py":           "import sqlite3\n",
			},
			want:     []Blocker{BlockedByLocalDisk},
			evidence: "disk that persists",
		},
		{
			// More than one thing can stop it, and each is reported: the reason
			// decides the answer, and two reasons are two different bills.
			name: "every reason it is blocked, in the order they are tested",
			files: map[string]string{
				"requirements.txt": "celery==5.4.0\ntorch==2.3.0\n",
				"app.py":           "import sqlite3\n",
			},
			want:     []Blocker{BlockedByBackgroundWork, BlockedByModelRuntime, BlockedByLocalDisk},
			evidence: "sizes the machine",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signals := DetectServerless(build(t, testCase.files))

			if !slices.Equal(signals[0].Values, []string{"blocked"}) {
				t.Fatalf("got %v, want [blocked]", signals[0].Values)
			}
			if signals[1].Field != FieldBlockedBy {
				t.Fatalf("got field %q, want %q", signals[1].Field, FieldBlockedBy)
			}
			want := make([]string, 0, len(testCase.want))
			for _, blocker := range testCase.want {
				want = append(want, string(blocker))
			}
			if !slices.Equal(signals[1].Values, want) {
				t.Errorf("got %v, want %v", signals[1].Values, want)
			}
			if !strings.Contains(signals[0].Evidence, testCase.evidence) {
				t.Errorf("evidence %q does not say %q", signals[0].Evidence, testCase.evidence)
			}
			// Both signals answer the same question, so they carry the same
			// evidence. A reason with no sentence behind it is not an answer.
			if signals[1].Evidence != signals[0].Evidence {
				t.Errorf("the fit and the reason disagree: %q against %q", signals[0].Evidence, signals[1].Evidence)
			}
		})
	}
}

func TestServerlessJudgesProductionDependenciesOnly(t *testing.T) {
	// Playwright in devDependencies is a test runner. The same name in
	// dependencies would be a browser the service drives at request time.
	// Treating them alike told an ordinary Express app it was sized by a
	// machine learning model.
	repo := build(t, map[string]string{
		"package.json": `{"dependencies":{"express":"^4"},"devDependencies":{"playwright":"^1.45"}}`,
	})

	if got := DetectServerless(repo)[0].Values; !slices.Equal(got, []string{"fits"}) {
		t.Errorf("got %v, want [fits]", got)
	}
	if got := RuntimeMatching(repo, HeavyRuntime); len(got) != 0 {
		t.Errorf("a test runner was read as a runtime dependency: %v", got)
	}
}

func TestHeldOpenInSourceIgnoresTests(t *testing.T) {
	// A test opens a socket to exercise something else and closes it again, so
	// it describes no deployment of its own.
	cases := []string{
		"tests/server.ts",
		"spec/server.ts",
		"__tests__/server.ts",
		"server.test.ts",
		"server_test.go",
		"server_spec.rb",
		"test_server.py",
	}

	for _, path := range cases {
		t.Run(path, func(t *testing.T) {
			repo := build(t, map[string]string{path: "const wss = new WebSocketServer({ port: 8080 });"})
			if got := HeldOpenInSource(repo); got != "" {
				t.Errorf("a test decided the deployment: %q", got)
			}
		})
	}
}

func TestHeldOpenInSourceWantsBothHalvesOfAListener(t *testing.T) {
	cases := []struct {
		name   string
		source string
		want   bool
	}{
		{
			// This code owns the socket and speaks its own protocol over it.
			name:   "listens and accepts",
			source: "l, _ := net.Listen(\"tcp\", \":9000\")\nfor {\n  c, _ := l.Accept()\n  go handle(c)\n}",
			want:   true,
		},
		{
			// A framework that calls net.Listen and hands the listener to an
			// HTTP server never calls Accept, and answers requests like anything
			// else.
			name:   "listens and hands the listener to an http server",
			source: "l, _ := net.Listen(\"tcp\", \":9000\")\nhttp.Serve(l, mux)",
			want:   false,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			repo := build(t, map[string]string{"main.go": testCase.source})
			if got := HeldOpenInSource(repo) != ""; got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestServerExecutedSourceFindsWhatHasNoMainFunction(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{
			name:  "a PHP page that reads the request",
			files: map[string]string{"index.php": "<?php echo $_POST['name'];"},
			want:  "index.php reads the request directly",
		},
		{
			name:  "a script under cgi-bin",
			files: map[string]string{"cgi-bin/hello.pl": "#!/usr/bin/perl\nprint \"hello\";"},
			want:  "cgi-bin/hello.pl sits under cgi-bin",
		},
		{
			// Somewhere else in the tree, the server configuration is what says
			// the file is executed rather than served.
			name: "a script the server configuration executes",
			files: map[string]string{
				"scripts/hello.pl": "#!/usr/bin/perl\nprint \"hello\";",
				".htaccess":        "Options +ExecCGI\nAddHandler cgi-script .pl\n",
			},
			want: "configures a web server to execute scripts/hello.pl",
		},
		{
			// A Perl script with nothing configured to run it is a script
			// somebody runs by hand, which is a different answer.
			name:  "a script nothing is configured to execute",
			files: map[string]string{"scripts/hello.pl": "#!/usr/bin/perl\nprint \"hello\";"},
			want:  "",
		},
		{
			// A PHP file that never touches the request is a library.
			name:  "a PHP file that answers no request",
			files: map[string]string{"src/Helper.php": "<?php\nfunction add($a, $b) { return $a + $b; }"},
			want:  "",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := ServerExecutedSource(build(t, testCase.files))
			if testCase.want == "" {
				if got != "" {
					t.Errorf("got %q, want nothing", got)
				}
				return
			}
			if !strings.Contains(got, testCase.want) {
				t.Errorf("got %q, want it to say %q", got, testCase.want)
			}
		})
	}
}

func TestBlockersIsTheClosedSetTheDetectorCanReport(t *testing.T) {
	// The reasons are vocabulary the rules match on, so the table is walked
	// rather than spot checked.
	seen := make(map[Blocker]bool, len(Blockers))
	for _, blocker := range Blockers {
		if blocker == "" {
			t.Error("an unnamed reason")
		}
		if seen[blocker] {
			t.Errorf("%q is listed twice", blocker)
		}
		seen[blocker] = true
		if string(blocker) != strings.ToLower(string(blocker)) || strings.ContainsAny(string(blocker), " -") {
			t.Errorf("%q is not the snake case a rule matches on", blocker)
		}
	}
	if len(Blockers) != 10 {
		t.Errorf("got %d reasons, want the 10 this detector can give", len(Blockers))
	}
}

func TestRuntimeSetsStayDistinct(t *testing.T) {
	// Each set is a different answer at a different price: a held connection
	// wants a cheap always on box, a model wants a machine chosen for the
	// model. A name in two sets would report two answers for one fact.
	sets := []struct {
		name    string
		members map[string]bool
	}{
		{"PersistentConnection", PersistentConnection},
		{"InProcessScheduler", InProcessScheduler},
		{"LongRunningBatch", LongRunningBatch},
		{"ModelRuntime", ModelRuntime},
		{"HeavyRuntime", HeavyRuntime},
	}

	owner := map[string]string{}
	for _, set := range sets {
		for name := range set.members {
			if name != strings.ToLower(name) {
				t.Errorf("%s holds %q, which is not lowercase and can never match", set.name, name)
			}
			if first, ok := owner[name]; ok {
				t.Errorf("%q is in both %s and %s", name, first, set.name)
				continue
			}
			owner[name] = set.name
		}
	}
}
