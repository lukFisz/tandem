package domain

import (
	"fmt"
	"strconv"
	"strings"
)

// LineRange is an inclusive, 1-based range of lines.
type LineRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// ParseLineRange parses "14" or "14-20".
func ParseLineRange(s string) (LineRange, error) {
	a, b, found := strings.Cut(strings.TrimSpace(s), "-")
	start, err := strconv.Atoi(a)
	if err != nil {
		return LineRange{}, fmt.Errorf("invalid line range %q: want N or N-M", s)
	}
	end := start
	if found {
		if end, err = strconv.Atoi(b); err != nil {
			return LineRange{}, fmt.Errorf("invalid line range %q: want N or N-M", s)
		}
	}
	if start < 1 || end < start {
		return LineRange{}, fmt.Errorf("invalid line range %q: lines start at 1 and end must be >= start", s)
	}
	return LineRange{Start: start, End: end}, nil
}

func (r LineRange) String() string {
	if r.Start == r.End {
		return strconv.Itoa(r.Start)
	}
	return fmt.Sprintf("%d-%d", r.Start, r.End)
}

// Within reports whether r lies inside the block lines [first, first+count-1].
func (r LineRange) Within(first, count int) bool {
	return r.Start >= first && r.End <= first+count-1
}

// CountLines counts lines in text; a trailing newline does not start a new line.
func CountLines(text string) int {
	if text == "" {
		return 0
	}
	return strings.Count(strings.TrimSuffix(text, "\n"), "\n") + 1
}
