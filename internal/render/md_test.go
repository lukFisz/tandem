package render

import "testing"

// Final review finding 6: Quote must treat "\r\n" and lone "\r" as line breaks, not literal
// characters, so text pasted from a Windows editor or an old-Mac source doesn't collapse into
// one quoted line with stray \r bytes inside it.
func TestQuoteNormalizesCRLF(t *testing.T) {
	got := Quote("first\r\nsecond\rthird\n")
	want := "> first\n> second\n> third\n"
	if got != want {
		t.Fatalf("Quote(CRLF) = %q, want %q", got, want)
	}
}

func TestQuotePlainLF(t *testing.T) {
	got := Quote("a\n\nb")
	want := "> a\n>\n> b\n"
	if got != want {
		t.Fatalf("Quote(LF) = %q, want %q", got, want)
	}
}
