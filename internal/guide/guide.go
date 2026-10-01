// Package guide embeds the agent protocol and the Claude Code skill shipped with Tandem.
package guide

import _ "embed"

//go:embed guide.md
var Guide string

//go:embed skill.md
var Skill string
