package domain

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// FormatID builds a session-scoped sequential id such as "t_3".
func FormatID(prefix string, n int) string { return fmt.Sprintf("%s_%d", prefix, n) }

// NewSessionID returns a random session id such as "s_8f2a1c".
func NewSessionID() string {
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "s_" + hex.EncodeToString(b[:])
}
