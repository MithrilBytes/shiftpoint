package scan

import (
	"slices"
	"strings"
	"testing"
)

func TestDatabaseReadsTheEngineOutOfEverySourceThatNamesOne(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  []string
	}{
		{
			name: "a prisma schema names its provider",
			files: map[string]string{
				"package.json":         "{}",
				"prisma/schema.prisma": "datasource db {\n  provider = \"postgresql\"\n}\n",
			},
			want: []string{"postgres"},
		},
		{
			name: "a drizzle config names its dialect",
			files: map[string]string{
				"package.json":      "{}",
				"drizzle.config.ts": `export default { dialect: "mysql" };`,
			},
			want: []string{"mysql"},
		},
		{
			name:  "a node dependency names the driver",
			files: map[string]string{"package.json": `{"dependencies":{"better-sqlite3":"^11"}}`},
			want:  []string{"sqlite"},
		},
		{
			name:  "a python requirement names the driver",
			files: map[string]string{"requirements.txt": "psycopg2-binary==2.9.9\n"},
			want:  []string{"postgres"},
		},
		{
			name:  "a Gemfile names the driver",
			files: map[string]string{"Gemfile": "gem \"rails\"\ngem \"pg\"\n"},
			want:  []string{"postgres"},
		},
		{
			// go.mod states an import path, and the driver is one segment of it.
			name:  "go.mod names the driver inside an import path",
			files: map[string]string{"go.mod": "module x\n\ngo 1.22\n\nrequire github.com/mattn/go-sqlite3 v1.14.22\n"},
			want:  []string{"sqlite"},
		},
		{
			// A cache is not a database, and reading one as though it were put a
			// datastore on the bill for a repository that keeps nothing.
			name: "a compose file runs a database image but not a cache",
			files: map[string]string{
				"package.json":       "{}",
				"docker-compose.yml": "services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n",
			},
			want: []string{"postgres"},
		},
		{
			name: "an env example names the engine in DATABASE_URL",
			files: map[string]string{
				"package.json": "{}",
				".env.example": "DATABASE_URL=postgres://user:pass@localhost:5432/app\n",
			},
			want: []string{"postgres"},
		},
		{
			// Laravel's driver is a PHP extension, so no dependency list shows it.
			name: "Laravel names its connection in the environment",
			files: map[string]string{
				"composer.json": `{"require":{"laravel/framework":"^11"}}`,
				".env.example":  "APP_NAME=Laravel\nDB_CONNECTION=mysql\n",
			},
			want: []string{"mysql"},
		},
		{
			// Django's engine is settings, not a dependency: sqlite3 ships with
			// Python and the ORM imports it internally.
			name: "Django names its engine in settings",
			files: map[string]string{
				"requirements.txt": "Django==5.0.6\n",
				"app/settings.py":  "DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3'}}\n",
			},
			want: []string{"sqlite"},
		},
		{
			name: "Ecto names its adapter in the repo module",
			files: map[string]string{
				"mix.exs":     "defp deps do [{:phoenix, \"~> 1.7\"}] end\n",
				"lib/repo.ex": "defmodule App.Repo do\n  use Ecto.Repo, adapter: Ecto.Adapters.Postgres\nend\n",
			},
			want: []string{"postgres"},
		},
		{
			name: "Spring names its database in the JDBC url",
			files: map[string]string{
				"pom.xml": "<project><artifactId>app</artifactId></project>",
				"src/main/resources/application.properties": "spring.datasource.url=jdbc:mysql://localhost/app\n",
			},
			want: []string{"mysql"},
		},
		{
			// PHP with no framework names the database in the connection call and
			// nowhere else.
			name:  "a PDO connection names the driver in its DSN",
			files: map[string]string{"index.php": "<?php $db = new PDO('mysql:host=localhost;dbname=app', $u, $p);"},
			want:  []string{"mysql"},
		},
		{
			name:  "the older PHP APIs are named after the database they talk to",
			files: map[string]string{"db.php": "<?php $link = pg_connect(\"host=localhost dbname=app\");"},
			want:  []string{"postgres"},
		},
		{
			// D1 is a SQL database the platform runs, not a file this application
			// has to keep, which is the distinction the whole ladder turns on.
			name: "a wrangler config binds a D1 database",
			files: map[string]string{
				"package.json":  "{}",
				"wrangler.toml": "name = \"worker\"\n\n[[d1_databases]]\nbinding = \"DB\"\n",
			},
			want: []string{"d1"},
		},
		{
			name:  "a composer requirement names the PDO extension",
			files: map[string]string{"composer.json": `{"require":{"ext-pdo_pgsql":"*"}}`},
			want:  []string{"postgres"},
		},
		{
			name:  "a csproj names the provider package",
			files: map[string]string{"App.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Npgsql" Version="8.0.3" /></ItemGroup></Project>`},
			want:  []string{"postgres"},
		},
		{
			// Either half of a Maven coordinate can be the recognisable half.
			name:  "a pom names the driver in its group",
			files: map[string]string{"pom.xml": "<project><dependencies><dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency></dependencies></project>"},
			want:  []string{"postgres"},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signal := DetectDatabase(build(t, testCase.files))[0]
			if signal.Field != FieldDatabase {
				t.Fatalf("got field %q, want %q", signal.Field, FieldDatabase)
			}
			if !slices.Equal(signal.Values, testCase.want) {
				t.Errorf("got %v, want %v", signal.Values, testCase.want)
			}
			if signal.Evidence == "" {
				t.Error("a finding with no evidence behind it")
			}
		})
	}
}

func TestDatabaseCountsAnImportedSqlite3(t *testing.T) {
	// The Python standard library ships sqlite3, so it never appears in a
	// manifest. Importing it is the only signal there is, and without it a
	// program whose entire state is a file on local disk looked stateless.
	repo := build(t, map[string]string{
		"requirements.txt": "Flask==3.0.3\n",
		"app.py":           "import sqlite3\n\ndb = sqlite3.connect('app.db')\n",
	})

	signal := DetectDatabase(repo)[0]
	if !slices.Equal(signal.Values, []string{"sqlite"}) {
		t.Fatalf("got %v, want [sqlite]", signal.Values)
	}
	if !strings.Contains(signal.Evidence, "app.py imports sqlite3") {
		t.Errorf("evidence does not name the import: %q", signal.Evidence)
	}
}

func TestDatabaseAsyncDriverNamesTheEngineItsSynchronousTwinDoes(t *testing.T) {
	// Missing these read a bot that keeps every member's score in a file on
	// local disk as having no database at all.
	cases := []struct {
		requirement string
		want        string
	}{
		{"aiosqlite==0.20.0", "sqlite"},
		{"aiomysql==0.2.0", "mysql"},
		{"asyncpg==0.29.0", "postgres"},
		{"motor==3.4.0", "mongo"},
	}

	for _, testCase := range cases {
		t.Run(testCase.requirement, func(t *testing.T) {
			repo := build(t, map[string]string{"requirements.txt": testCase.requirement + "\n"})
			if got := DetectDatabase(repo)[0].Values; !slices.Equal(got, []string{testCase.want}) {
				t.Errorf("got %v, want [%s]", got, testCase.want)
			}
		})
	}
}

func TestDatabaseSetsAsideAnEngineTheLadderDoesNotPrice(t *testing.T) {
	// SQL Server is read and set aside rather than folded into an engine it is
	// not. Reporting it as something else would be worse than not reading it.
	repo := build(t, map[string]string{
		"mix.exs":     "defp deps do [{:phoenix, \"~> 1.7\"}] end\n",
		"lib/repo.ex": "use Ecto.Repo, adapter: Ecto.Adapters.Tds\n",
	})

	if got := DetectDatabase(repo)[0].Values; !slices.Equal(got, []string{None}) {
		t.Errorf("got %v, want [none]", got)
	}
}

func TestDatabaseAbsenceIsRatedByWhatThereWasToRead(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  Confidence
	}{
		{
			// Evidence of absence: something stated what this depends on.
			name:  "a manifest with no database client",
			files: map[string]string{"package.json": `{"dependencies":{"express":"^4"}}`},
			want:  Medium,
		},
		{
			// Absence of evidence. Nothing here could have said so either way.
			name:  "nothing to read at all",
			files: map[string]string{"index.html": "<h1>hello</h1>"},
			want:  Low,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signal := DetectDatabase(build(t, testCase.files))[0]
			if !slices.Equal(signal.Values, []string{None}) {
				t.Fatalf("got %v, want [none]", signal.Values)
			}
			if signal.Confidence != testCase.want {
				t.Errorf("got %v, want %v", signal.Confidence, testCase.want)
			}
			if signal.Evidence == "" {
				t.Error("an absence with no evidence behind it")
			}
		})
	}
}

func TestDatabaseSortsEnginesAndKeepsTheEvidenceForEach(t *testing.T) {
	// Two datastores is a real answer, not a tie to be broken. The values are
	// sorted so a rule can match them, and each keeps the sentence that found
	// it.
	repo := build(t, map[string]string{
		"package.json": `{"dependencies":{"pg":"^8","mongoose":"^8"}}`,
	})

	signal := DetectDatabase(repo)[0]
	if !slices.Equal(signal.Values, []string{"mongo", "postgres"}) {
		t.Fatalf("got %v, want [mongo postgres]", signal.Values)
	}
	for _, name := range []string{"mongoose", "pg"} {
		if !strings.Contains(signal.Evidence, name) {
			t.Errorf("evidence does not name %s: %q", name, signal.Evidence)
		}
	}
	if signal.Confidence != High {
		t.Errorf("got %v, want high", signal.Confidence)
	}
}

func TestEngineByAliasOnlyNamesEnginesTheLadderPrices(t *testing.T) {
	// A value here is vocabulary the rules match on, so the table is walked
	// rather than spot checked. Keys are compared against lowercased names, so
	// an upper case one would simply never match.
	engines := map[string]bool{"postgres": true, "mysql": true, "sqlite": true, "mongo": true}

	for alias, engine := range EngineByAlias {
		if alias != strings.ToLower(alias) {
			t.Errorf("alias %q is not lowercase, so it can never match", alias)
		}
		if !engines[engine] {
			t.Errorf("alias %q maps to %q, which is not an engine this tool prices", alias, engine)
		}
	}
}
