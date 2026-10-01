package domain_test

import (
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/domain/domaintest"
)

func TestBlocksRecordTheirSeq(t *testing.T) {
	s, events := domaintest.Build(t,
		&domain.AddStage{Title: "A"},
		&domain.AddThread{Title: "T"},
		&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindNote, Text: "x"}},
	)
	got, want := s.Blocks["b_1"].Seq, events[len(events)-1].Seq
	if got == 0 || got != want {
		t.Fatalf("b_1.Seq = %d, want %d", got, want)
	}
}
