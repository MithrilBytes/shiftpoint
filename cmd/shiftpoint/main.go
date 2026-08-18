// Command shiftpoint reads a repository and says what infrastructure it needs.
package main

import (
	"os"

	"github.com/MithrilBytes/shiftpoint/internal/cli"
)

// version is stamped at build time with:
//
//	go build -ldflags "-X main.version=$(git describe --tags)"
//
// It falls back to the tag this source was cut from, so a plain `go build`
// still reports something truthful.
var version = "v0.2.0"

func main() {
	os.Exit(cli.Run(os.Args[1:], version, os.Stdout, os.Stderr))
}
