package scan

import (
	"regexp"
	"sort"
	"strings"
)

var (
	prismaSchema   = regexp.MustCompile(`(^|/)schema\.prisma$`)
	drizzleConfig  = regexp.MustCompile(`(^|/)drizzle\.config\.[cm]?[jt]s$`)
	envExample     = regexp.MustCompile(`(^|/)\.env(\.example|\.sample|\.template)?$`)
	pythonSource   = regexp.MustCompile(`\.py$`)
	elixirSource   = regexp.MustCompile(`\.exs?$`)
	phpSource      = regexp.MustCompile(`\.php$`)
	springConfig   = regexp.MustCompile(`(^|/)application(-[^/]+)?\.(properties|ya?ml)$`)
	wranglerConfig = regexp.MustCompile(`(^|/)wrangler\.(toml|jsonc?)$`)
)

// PHP with no framework names its database in the connection call and nowhere
// else: the driver is a PHP extension rather than a composer package, and there
// is frequently no composer.json to look in. A PDO DSN starts with the driver,
// and the two older APIs are named after the database they talk to.
var phpConnection = regexp.MustCompile(`(?i)new\s+PDO\s*\(\s*["']([a-z0-9]+):|\b(mysqli_connect|new\s+mysqli|pg_connect)\s*\(`)

// Cloudflare declares what a Worker is wired to in wrangler.toml. A D1 binding
// is a SQL database the platform runs and backs up, not a file on a disk this
// application has to keep, which is the distinction the whole ladder turns on.
var d1Binding = regexp.MustCompile(`\[\[\s*d1_databases\s*\]\]|["']d1_databases["']\s*:`)

// Laravel names its connection in .env and nowhere a dependency list can show
// it: the driver is a PHP extension, not a composer package.
var laravelConnection = regexp.MustCompile(`(?im)^\s*DB_CONNECTION\s*=\s*["']?([a-z0-9]+)`)

// Spring names its database in the JDBC URL, whichever of the two config
// formats the project uses.
var jdbcURL = regexp.MustCompile(`(?i)jdbc:([a-z0-9]+):`)

// Ecto names its adapter in the repo module, the same way Django names its
// engine in settings. Neither is a dependency, and neither is guessable.
var ectoAdapter = regexp.MustCompile(`Ecto\.Adapters\.(Postgres|MyXQL|SQLite3|Tds)`)

// Django declares its database in settings, not in a dependency. Nothing else
// in the repository names it: sqlite3 is in the standard library and the ORM
// imports it internally. Without this, a Django app whose entire state is a
// file on local disk was told a function tier would do, which is the one
// deployment that loses the data.
var djangoEngine = regexp.MustCompile(`django\.db\.backends\.(sqlite3|postgresql[_a-z]*|mysql)`)

var (
	prismaProvider = regexp.MustCompile(`provider\s*=\s*"([^"]+)"`)
	drizzleDialect = regexp.MustCompile(`dialect\s*:\s*["']([^"']+)["']`)
	sqliteImport   = regexp.MustCompile(`\bimport\s+sqlite3\b|\bsqlite3\.connect\b`)
	databaseURL    = regexp.MustCompile(`(?i)DATABASE_URL\s*=\s*["']?([a-z0-9+]+):`)
)

// EngineByAlias maps every name this detector understands onto the engine's
// vocabulary.
//
// An async driver names the same engine its synchronous counterpart does.
// aiosqlite is sqlite, aiomysql is mysql, motor is mongo. Missing them read a
// bot that keeps every member's score in a file on local disk as having no
// database at all, which is the one deployment detail that loses the data.
var EngineByAlias = map[string]string{
	"postgresql":               "postgres",
	"postgres":                 "postgres",
	"pg":                       "postgres",
	"psycopg":                  "postgres",
	"psycopg2":                 "postgres",
	"psycopg2-binary":          "postgres",
	"asyncpg":                  "postgres",
	"aiopg":                    "postgres",
	"pgx":                      "postgres",
	"pq":                       "postgres",
	"postgres.js":              "postgres",
	"@supabase/supabase-js":    "postgres",
	"@neondatabase/serverless": "postgres",
	"@vercel/postgres":         "postgres",
	"mysql":                    "mysql",
	"mysql2":                   "mysql",
	"mysqlclient":              "mysql",
	"pymysql":                  "mysql",
	"aiomysql":                 "mysql",
	"asyncmy":                  "mysql",
	"mariadb":                  "mysql",
	"@planetscale/database":    "mysql",
	"sqlite":                   "sqlite",
	"sqlite3":                  "sqlite",
	"aiosqlite":                "sqlite",
	"better-sqlite3":           "sqlite",
	"@libsql/client":           "sqlite",
	"libsql":                   "sqlite",
	"mongodb":                  "mongo",
	"mongo":                    "mongo",
	"mongoose":                 "mongo",
	"pymongo":                  "mongo",
	"motor":                    "mongo",
	"mongoid":                  "mongo",

	// Elixir. Ecto talks to a database through one of these drivers, and the
	// driver is named in mix.exs even when the adapter is not.
	"postgrex":     "postgres",
	"myxql":        "mysql",
	"ecto_sqlite3": "sqlite",
	"exqlite":      "sqlite",

	// JVM. A pom names the group and the artifact, and either half can be the
	// half that says which database this is.
	"org.postgresql":       "postgres",
	"mysql-connector-j":    "mysql",
	"mysql-connector-java": "mysql",
	"mariadb-java-client":  "mysql",
	"mongodb-driver-sync":  "mongo",
	"sqlite-jdbc":          "sqlite",

	// PHP. The driver is a PHP extension, and a composer.json that requires one
	// is naming the database. pgsql is what PDO calls Postgres, in a DSN and in
	// an extension name alike.
	"ext-pdo_pgsql":  "postgres",
	"ext-pdo_mysql":  "mysql",
	"ext-pdo_sqlite": "sqlite",
	"ext-mongodb":    "mongo",
	"pgsql":          "postgres",

	// .NET. A csproj names the provider package, and the provider is the
	// database. SQL Server has no place on this ladder, so it is not listed:
	// reading it as something it is not would be worse than not reading it.
	"npgsql":                                "postgres",
	"npgsql.entityframeworkcore.postgresql": "postgres",
	"mysqlconnector":                        "mysql",
	"mysql.data":                            "mysql",
	"pomelo.entityframeworkcore.mysql":      "mysql",
	"microsoft.entityframeworkcore.sqlite":  "sqlite",
	"microsoft.data.sqlite":                 "sqlite",
	"system.data.sqlite":                    "sqlite",
	"mongodb.driver":                        "mongo",
}

// Scanning source files is the expensive path, so it is bounded. The serverless
// detector reads the same bound rather than setting one of its own.
const maxSourceFilesScanned = 200

// DetectDatabase reports which database the application talks to.
//
// When nothing turns up, the confidence of that absence depends on whether
// there was anything to read. A package.json with no database client is
// evidence of absence (medium). No manifest at all is absence of evidence
// (low), and this detector says so rather than guessing.
func DetectDatabase(repo *Repo) []Signal {
	// The first sighting of an engine keeps the evidence, so the sentence names
	// where it was read rather than wherever it last turned up. Insertion order
	// is held separately because a Go map has none.
	evidence := make(map[string]string)
	var order []string

	note := func(engine, sentence string) {
		if engine == "" || evidence[engine] != "" {
			return
		}
		evidence[engine] = sentence
		order = append(order, engine)
	}
	// noteAlias exists because every dependency manifest says the same thing in
	// the same shape: this file requires this name.
	noteAlias := func(name, phrase string) {
		if engine := EngineByAlias[name]; engine != "" {
			note(engine, phrase+" "+name)
		}
	}

	for _, file := range repo.Matching(prismaSchema.MatchString) {
		for _, match := range prismaProvider.FindAllStringSubmatch(repo.Read(file), -1) {
			note(EngineByAlias[strings.ToLower(match[1])], file+" sets provider "+match[1])
		}
	}

	for _, file := range repo.Matching(drizzleConfig.MatchString) {
		if match := drizzleDialect.FindStringSubmatch(repo.Read(file)); match != nil {
			note(EngineByAlias[strings.ToLower(match[1])], file+" sets dialect "+match[1])
		}
	}

	// Dependency names are read in sorted order rather than the order the
	// manifest happens to list them. Go map iteration is deliberately random,
	// and without this the evidence sentence for an engine named twice changed
	// between runs of the same scan.
	for _, name := range sortedNames(NodeDependencies(repo)) {
		noteAlias(name, "package.json depends on")
	}
	for _, name := range sortedNames(PythonDependencies(repo)) {
		noteAlias(name, "a python manifest requires")
	}
	for _, name := range sortedNames(RubyDependencies(repo)) {
		noteAlias(name, "Gemfile requires")
	}
	for _, name := range sortedNames(GoDependencies(repo)) {
		noteAlias(name, "go.mod requires")
	}
	for _, source := range OtherLanguageSources(repo) {
		for _, name := range sortedNames(source.Names) {
			noteAlias(name, source.Evidence)
		}
	}

	pythonFiles := firstN(repo.Matching(pythonSource.MatchString), maxSourceFilesScanned)
	for _, file := range pythonFiles {
		for _, match := range djangoEngine.FindAllStringSubmatch(repo.Read(file), -1) {
			backend := strings.ToLower(match[1])
			engine := "sqlite"
			switch {
			case strings.HasPrefix(backend, "postgresql"):
				engine = "postgres"
			case backend == "mysql":
				engine = "mysql"
			}
			note(engine, file+" sets the Django "+backend+" backend")
		}
	}

	// The Python standard library ships sqlite3, so it never appears in a
	// manifest. Importing it is the only signal there is.
	if evidence["sqlite"] == "" {
		for _, file := range pythonFiles {
			if sqliteImport.MatchString(repo.Read(file)) {
				note("sqlite", file+" imports sqlite3")
				break
			}
		}
	}

	for _, file := range firstN(repo.Matching(elixirSource.MatchString), maxSourceFilesScanned) {
		for _, match := range ectoAdapter.FindAllStringSubmatch(repo.Read(file), -1) {
			adapter := strings.ToLower(match[1])
			// SQL Server has no place on this ladder, so it is read and set
			// aside rather than folded into an engine it is not.
			if adapter == "tds" {
				continue
			}
			engine := "sqlite"
			switch adapter {
			case "postgres":
				engine = "postgres"
			case "myxql":
				engine = "mysql"
			}
			note(engine, file+" sets the Ecto "+match[1]+" adapter")
		}
	}

	for _, file := range firstN(repo.Matching(phpSource.MatchString), maxSourceFilesScanned) {
		for _, match := range phpConnection.FindAllStringSubmatch(repo.Read(file), -1) {
			if dsn := strings.ToLower(match[1]); dsn != "" {
				note(EngineByAlias[dsn], file+" opens a "+dsn+" PDO connection")
				continue
			}
			call := strings.ToLower(match[2])
			engine := "mysql"
			if strings.Contains(call, "pg_") {
				engine = "postgres"
			}
			note(engine, file+" calls "+match[2])
		}
	}

	for _, file := range repo.Matching(wranglerConfig.MatchString) {
		if d1Binding.MatchString(repo.Read(file)) {
			note("d1", file+" binds a D1 database to this Worker")
		}
	}

	for _, file := range repo.Matching(springConfig.MatchString) {
		for _, match := range jdbcURL.FindAllStringSubmatch(repo.Read(file), -1) {
			note(EngineByAlias[strings.ToLower(match[1])], file+" sets a jdbc:"+match[1]+" url")
		}
	}

	if compose := ComposeServices(repo); compose != nil {
		for _, image := range compose.Images {
			name := imageName(image)
			note(EngineByAlias[strings.ToLower(name)], "a compose file runs the "+name+" image")
		}
	}

	for _, file := range repo.Matching(envExample.MatchString) {
		text := repo.Read(file)
		if match := databaseURL.FindStringSubmatch(text); match != nil {
			note(EngineByAlias[strings.ToLower(match[1])], file+" sets a "+match[1]+" DATABASE_URL")
		}
		if match := laravelConnection.FindStringSubmatch(text); match != nil {
			note(EngineByAlias[strings.ToLower(match[1])], file+" sets DB_CONNECTION to "+match[1])
		}
	}

	if len(order) > 0 {
		sentences := make([]string, 0, len(order))
		for _, engine := range order {
			sentences = append(sentences, evidence[engine])
		}
		engines := append([]string(nil), order...)
		sort.Strings(engines)
		return []Signal{Found(FieldDatabase, High, strings.Join(sentences, "; "), engines...)}
	}

	if manifests := ManifestFiles(repo); len(manifests) > 0 {
		return []Signal{Absent(FieldDatabase, Medium, "no database client in "+strings.Join(manifests, ", "))}
	}

	return []Signal{Absent(FieldDatabase, Low, "no dependency manifest to read, so absence of a database is unproven")}
}

// imageName strips the registry, the repository and the tag from a container
// image, leaving the name the image is known by: ghcr.io/acme/postgres:16 is
// postgres.
func imageName(image string) string {
	if cut := strings.LastIndex(image, "/"); cut >= 0 {
		image = image[cut+1:]
	}
	name, _, _ := strings.Cut(image, ":")
	return name
}

// sortedNames orders a set of dependency names so a scan of the same repository
// reports the same evidence twice running.
func sortedNames(names map[string]bool) []string {
	sorted := make([]string, 0, len(names))
	for name := range names {
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	return sorted
}

// firstN caps a list of files at the number a detector is willing to read.
func firstN(paths []string, limit int) []string {
	return paths[:min(len(paths), limit)]
}
