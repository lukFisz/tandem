package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// PutBlob stores content under its sha256 and returns the hex id; identical content is stored once.
func PutBlob(dir string, content []byte) (string, error) {
	sum := sha256.Sum256(content)
	sha := hex.EncodeToString(sum[:])
	path := filepath.Join(dir, sha)
	if _, err := os.Stat(path); err == nil {
		return sha, nil
	}
	if err := writeFileAtomic(path, content, 0o600); err != nil {
		return "", err
	}
	return sha, nil
}

func GetBlob(dir, sha string) ([]byte, error) {
	if !shaPattern.MatchString(sha) {
		return nil, fmt.Errorf("invalid blob id %q", sha)
	}
	return os.ReadFile(filepath.Join(dir, sha))
}
