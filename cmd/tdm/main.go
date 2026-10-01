package main

import (
	"os"

	"github.com/lukFisz/tandem/internal/cli"
)

// version is set at build time: go build -ldflags "-X main.version=v0.1.0".
var version = "dev"

func main() {
	os.Exit(cli.Execute(cli.ResolveVersion(version), os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
