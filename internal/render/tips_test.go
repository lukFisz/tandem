package render

import (
	"regexp"
	"strings"
	"testing"

	"github.com/lukFisz/tandem/internal/guide"
)

func TestTipRotation(t *testing.T) {
	for i := 0; i <= 3; i++ {
		if got := Tip(i); got != "" {
			t.Errorf("Tip(%d) = %q, want empty", i, got)
		}
	}
	if got := Tip(4); !strings.HasPrefix(got, "Tip: ") || !strings.Contains(got, tips[0]) {
		t.Errorf("Tip(4) = %q", got)
	}
	if got := Tip(9); !strings.Contains(got, tips[1]) {
		t.Errorf("Tip(9) = %q", got)
	}
	if got := Tip(TipEvery*len(tips) - 1); !strings.Contains(got, tips[len(tips)-1]) {
		t.Errorf("last Tip = %q", got)
	}
	if got := Tip(TipEvery*len(tips) + TipEvery - 1); !strings.Contains(got, tips[0]) {
		t.Errorf("wrapped Tip = %q", got)
	}
	if len(Tips()) != len(tips) {
		t.Errorf("Tips() len = %d", len(Tips()))
	}
}

func TestTipCommandsAreInGuide(t *testing.T) {
	code := regexp.MustCompile("`(tdm [^`]*)`")
	for i, tip := range tips {
		for _, m := range code.FindAllStringSubmatch(tip, -1) {
			words := strings.Fields(m[1])
			if len(words) < 2 {
				continue
			}
			candidates := []string{"| `" + strings.Join(words[:2], " ")}
			if len(words) > 2 {
				candidates = append(candidates, "| `"+strings.Join(words[:3], " "))
			}
			found := false
			for _, c := range candidates {
				if strings.Contains(guide.Guide, "\n"+c) {
					found = true
				}
			}
			if !found {
				t.Errorf("tip %d: %q is not in the guide Commands table", i, m[1])
			}
		}
	}
}
