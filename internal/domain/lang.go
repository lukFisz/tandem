package domain

import (
	"path/filepath"
	"strings"
)

var langByExt = map[string]string{
	".go": "go", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".py": "python",
	".md": "markdown", ".ts": "typescript", ".tsx": "tsx", ".js": "javascript",
	".json": "json", ".yaml": "yaml", ".yml": "yaml", ".sh": "bash", ".sql": "sql",
}

// LangFromPath guesses the highlighting language from a file extension ("text" when unknown).
func LangFromPath(path string) string {
	if lang, ok := langByExt[strings.ToLower(filepath.Ext(path))]; ok {
		return lang
	}
	return "text"
}
