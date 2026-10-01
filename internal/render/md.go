// Package render produces the compact markdown the agent reads.
package render

import "strings"

type BlobReader func(sha string) ([]byte, error)

// Fence wraps content in a code fence longer than any backtick run inside it.
func Fence(lang, content string) string {
	longest, run := 0, 0
	for _, r := range content {
		if r == '`' {
			run++
			longest = max(longest, run)
		} else {
			run = 0
		}
	}
	fence := strings.Repeat("`", max(3, longest+1))
	return fence + lang + "\n" + strings.TrimSuffix(content, "\n") + "\n" + fence + "\n"
}

// Quote prefixes every line with "> " so user text can never become output structure.
func Quote(text string) string {
	// Normalize "\r\n" and lone "\r" to "\n" first: text from a Windows editor or browser
	// textarea can carry either, and without this a "\r\n" line ending would leave a stray \r
	// glued to the end of the quoted line, and a lone "\r" would not break the line at all.
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	var b strings.Builder
	for _, line := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		if line == "" {
			b.WriteString(">\n")
		} else {
			b.WriteString("> " + line + "\n")
		}
	}
	return b.String()
}
