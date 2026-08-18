package scan

import (
	"slices"
	"strings"
	"testing"
)

func TestDetectContainerReadsPackaging(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  []string
	}{
		{
			name:  "a Dockerfile and a compose file",
			files: map[string]string{"Dockerfile": "FROM node:20", "docker-compose.yml": "services:\n  web:\n    build: .\n"},
			want:  []string{"dockerfile", "compose"},
		},
		{
			name:  "a suffixed Dockerfile still builds an image",
			files: map[string]string{"Dockerfile.prod": "FROM node:20"},
			want:  []string{"dockerfile"},
		},
		{
			name:  "compose on its own",
			files: map[string]string{"compose.yaml": "services:\n  web:\n    build: .\n"},
			want:  []string{"compose"},
		},
		{
			// The suffix may not contain a separator, or a directory of build
			// fragments would count as an image this repository ships.
			name:  "a Dockerfile.d directory is not a build",
			files: map[string]string{"Dockerfile.d/base": "FROM node:20"},
			want:  []string{None},
		},
		{
			name:  "nothing at all",
			files: map[string]string{"main.go": "package main"},
			want:  []string{None},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signals := DetectContainer(build(t, testCase.files))
			if got := signalFor(t, signals, FieldContainer).Values; !slices.Equal(got, testCase.want) {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestAppServicesCountsApplicationsNotBackingServices(t *testing.T) {
	repo := build(t, map[string]string{
		"docker-compose.yml": "services:\n  web:\n    build: .\n  worker:\n    build: .\n" +
			"  db:\n    image: postgres:16\n  redis:\n    image: redis:7\n",
	})

	services := signalFor(t, DetectContainer(repo), FieldAppServices)
	if services.Metric != 2 {
		t.Errorf("got %d application services, want 2", services.Metric)
	}
	if !strings.Contains(services.Evidence, "2 backing service(s)") {
		t.Errorf("evidence does not account for the backing services: %q", services.Evidence)
	}
}

func TestUnparsableComposeStillCountsAsPackaging(t *testing.T) {
	// The file being there is a fact about the repository even when its
	// contents are not readable YAML. What it cannot support is a count.
	signals := DetectContainer(build(t, map[string]string{"docker-compose.yml": "services: [unbalanced\n"}))

	if got := signalFor(t, signals, FieldContainer).Values; !slices.Equal(got, []string{"compose"}) {
		t.Errorf("got %v, want [compose]", got)
	}
	if len(signals) != 1 {
		t.Errorf("counted services from a file that does not parse: %v", signals)
	}
}

func TestProxyBackendsCountAsApplicationServices(t *testing.T) {
	// A proxy naming two backends is two processes of this repository's own
	// code, which is the fact a compose file states in its own dialect.
	repo := build(t, map[string]string{
		"deploy/nginx.conf": "server {\n" +
			"  location / { proxy_pass http://web:3000; }\n" +
			"  location /api { proxy_pass http://api:8000/; }\n}\n",
	})

	services := signalFor(t, DetectContainer(repo), FieldAppServices)
	if services.Metric != 2 {
		t.Fatalf("got %d backends, want 2", services.Metric)
	}
	if !strings.Contains(services.Evidence, "api:8000, web:3000") {
		t.Errorf("evidence does not name the backends in a stable order: %q", services.Evidence)
	}
}

func TestOneProxiedBackendSaysNothingNew(t *testing.T) {
	// One backend is one application, which is what a proxy in front of a
	// single service says and is no news.
	signals := DetectContainer(build(t, map[string]string{"Caddyfile": "example.com {\n  reverse_proxy web:3000\n}\n"}))

	if len(signals) != 1 {
		t.Errorf("a single backend was counted as demand: %v", signals)
	}
}

func TestExposedPortIsReadFromTheImageBuildOnly(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{
			name:  "a Dockerfile that declares a port",
			files: map[string]string{"Dockerfile": "FROM node:20\nexpose 8080\nCMD [\"node\"]\n"},
			want:  "Dockerfile exposes port 8080",
		},
		{
			// A compose file may be pinning somebody else's image, so a port
			// published there says nothing about this repository's own code.
			name:  "ports published by compose",
			files: map[string]string{"docker-compose.yml": "services:\n  web:\n    image: nginx\n    ports:\n      - 8080:80\n"},
			want:  "",
		},
		{
			name:  "a batch image that listens to nobody",
			files: map[string]string{"Dockerfile": "FROM python:3.12\nCMD [\"python\", \"job.py\"]\n"},
			want:  "",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := ExposedPort(build(t, testCase.files))
			if testCase.want == "" && got != "" {
				t.Errorf("got %q, want no evidence", got)
			}
			if testCase.want != "" && !strings.Contains(got, testCase.want) {
				t.Errorf("got %q, want it to contain %q", got, testCase.want)
			}
		})
	}
}
