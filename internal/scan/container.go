package scan

import (
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// IsDockerfile reports whether a path is a build that produces an image.
//
// Shared with the shape detector, which reads it as an artefact this
// repository makes rather than a thing it runs. The optional suffix may not
// contain a separator, so Dockerfile.prod is one and a Dockerfile.d/ directory
// of fragments is not.
func IsDockerfile(file string) bool {
	name := path.Base(file)
	return name == "Dockerfile" || (strings.HasPrefix(name, "Dockerfile.") && name != "Dockerfile.")
}

// Dockerfiles lists every image build in the repository.
func Dockerfiles(repo *Repo) []string {
	return repo.Matching(IsDockerfile)
}

// isProxyConfig reports whether a path is a checked in reverse proxy
// configuration: an nginx style .conf, or a Caddyfile.
func isProxyConfig(file string) bool {
	name := path.Base(file)
	if strings.HasSuffix(name, ".conf") && name != ".conf" {
		return true
	}
	return name == "Caddyfile" || (strings.HasPrefix(name, "Caddyfile.") && name != "Caddyfile.")
}

var proxyTargetPattern = regexp.MustCompile(`(?:proxy_pass|reverse_proxy)\s+(?:https?://)?([^\s;{]+)`)

// proxiedBackends lists the distinct backends a checked in reverse proxy
// routes to.
//
// A proxy naming two backends is two processes of this repository's own code
// running side by side, which is the same fact a compose file states when it
// declares two application services. It is read for the same reason and with
// the same care: what is running, never how many copies of it somebody would
// like to start.
func proxiedBackends(repo *Repo) []string {
	seen := make(map[string]bool)
	for _, file := range repo.Matching(isProxyConfig) {
		for _, match := range proxyTargetPattern.FindAllStringSubmatch(repo.Read(file), -1) {
			target := strings.ToLower(strings.TrimRight(match[1], "/"))
			if target != "" {
				seen[target] = true
			}
		}
	}
	targets := make([]string, 0, len(seen))
	for target := range seen {
		targets = append(targets, target)
	}
	sort.Strings(targets)
	return targets
}

var exposePattern = regexp.MustCompile(`(?im)^\s*EXPOSE\s+(\d+)`)

// ExposedPort returns the evidence that this repository's own image declares a
// port it listens on, or "" when none does.
//
// EXPOSE is the author stating, in the file that builds this code into an
// image, that the process inside it accepts connections. Nobody writes it for
// a command line tool or a batch job. It is read only from a Dockerfile and
// never from a compose file, because a Dockerfile builds this repository's
// source while a compose file may be pinning somebody else's image.
func ExposedPort(repo *Repo) string {
	for _, file := range Dockerfiles(repo) {
		if match := exposePattern.FindStringSubmatch(repo.Read(file)); match != nil {
			return fmt.Sprintf("%s exposes port %s, so the image is built to be listened to", file, match[1])
		}
	}
	return ""
}

// DetectContainer reports how the application is packaged, plus how many
// services it is actually made of. The service count feeds demand: shipping
// two application services is something the repository does, not something it
// merely configures.
func DetectContainer(repo *Repo) []Signal {
	var values, evidence []string

	if dockerfiles := Dockerfiles(repo); len(dockerfiles) > 0 {
		values = append(values, "dockerfile")
		evidence = append(evidence, strings.Join(dockerfiles, ", "))
	}
	if compose := ComposeFiles(repo); len(compose) > 0 {
		values = append(values, "compose")
		evidence = append(evidence, strings.Join(compose, ", "))
	}

	container := Absent(FieldContainer, High, "no Dockerfile or compose file")
	if len(values) > 0 {
		container = Found(FieldContainer, High, "found "+strings.Join(evidence, ", "), values...)
	}

	services := ComposeServices(repo)
	backends := proxiedBackends(repo)
	composed := 0
	if services != nil {
		composed = len(services.App)
	}

	// One backend is one application, which is what a proxy in front of a
	// single service says and is no news. Below two it adds nothing compose
	// has not already said.
	if services == nil && len(backends) < 2 {
		return []Signal{container}
	}

	reason := "compose declares no application service of its own"
	if composed > 0 {
		reason = fmt.Sprintf("compose runs %s alongside %d backing service(s)",
			strings.Join(services.App, ", "), len(services.Infrastructure))
	}
	if len(backends) > composed {
		reason = fmt.Sprintf("a proxy configuration routes to %d separate backends: %s",
			len(backends), strings.Join(backends, ", "))
	}

	return []Signal{container, {
		Field:      FieldAppServices,
		Confidence: High,
		Metric:     max(composed, len(backends)),
		Evidence:   reason,
	}}
}
