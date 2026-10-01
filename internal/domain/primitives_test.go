package domain

import (
	"regexp"
	"testing"
)

func TestParseLineRange(t *testing.T) {
	cases := []struct {
		in   string
		want LineRange
		ok   bool
	}{
		{"14", LineRange{14, 14}, true},
		{"14-20", LineRange{14, 20}, true},
		{" 3-3 ", LineRange{3, 3}, true},
		{"0", LineRange{}, false},
		{"5-4", LineRange{}, false},
		{"a-b", LineRange{}, false},
		{"", LineRange{}, false},
	}
	for _, tc := range cases {
		got, err := ParseLineRange(tc.in)
		if (err == nil) != tc.ok {
			t.Fatalf("ParseLineRange(%q) err = %v, want ok=%v", tc.in, err, tc.ok)
		}
		if tc.ok && got != tc.want {
			t.Fatalf("ParseLineRange(%q) = %+v, want %+v", tc.in, got, tc.want)
		}
	}
}

func TestLineRangeStringAndWithin(t *testing.T) {
	if s := (LineRange{14, 14}).String(); s != "14" {
		t.Fatalf("String = %q", s)
	}
	if s := (LineRange{14, 15}).String(); s != "14-15" {
		t.Fatalf("String = %q", s)
	}
	// block covers lines 12..15
	if !(LineRange{12, 15}).Within(12, 4) || (LineRange{15, 16}).Within(12, 4) || (LineRange{11, 12}).Within(12, 4) {
		t.Fatal("Within gives wrong answer for block 12..15")
	}
}

func TestCountLines(t *testing.T) {
	for in, want := range map[string]int{"": 0, "a": 1, "a\n": 1, "a\nb": 2, "a\n\n": 2} {
		if got := CountLines(in); got != want {
			t.Fatalf("CountLines(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestEventRoundTrip(t *testing.T) {
	e := NewEvent(ActorAI, "x.y", map[string]string{"k": "v"})
	if e.V != 1 || e.Actor != ActorAI || e.Type != "x.y" {
		t.Fatalf("unexpected envelope %+v", e)
	}
	var got map[string]string
	if err := e.Decode(&got); err != nil || got["k"] != "v" {
		t.Fatalf("Decode = %v, %v", got, err)
	}
}

func TestIDs(t *testing.T) {
	if FormatID("t", 3) != "t_3" {
		t.Fatal("FormatID")
	}
	if id := NewSessionID(); !regexp.MustCompile(`^s_[0-9a-f]{6}$`).MatchString(id) {
		t.Fatalf("NewSessionID = %q", id)
	}
}

func TestLangFromPath(t *testing.T) {
	for path, want := range map[string]string{
		"a/B.kt": "kotlin", "x.kts": "kotlin", "Main.java": "java", "main.go": "go",
		"s.py": "python", "README.md": "markdown", "noext": "text",
	} {
		if got := LangFromPath(path); got != want {
			t.Fatalf("LangFromPath(%q) = %q, want %q", path, got, want)
		}
	}
}
