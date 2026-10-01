package daemon

import (
	"errors"
	"sync"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/store"
)

var testProject = store.Project{ID: "p1", RootPath: "/tmp/p1", Name: "p1"}

func newManager(t *testing.T, home string) *Manager {
	t.Helper()
	m, err := NewManager(home)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	return m
}

func TestCreateExecuteReload(t *testing.T) {
	home := t.TempDir()
	m := newManager(t, home)
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.Execute(&domain.AddStage{Title: "A"})
	if err != nil || res.ID != "st_1" {
		t.Fatalf("Execute = %+v, %v", res, err)
	}
	m.Close()

	m2 := newManager(t, home)
	s2, err := m2.Get(s.ID())
	if err != nil {
		t.Fatal(err)
	}
	s2.Read(func(st *domain.State, evs []domain.Event) {
		if st.Session.Title != "Idea" || st.Stage("st_1") == nil || len(evs) != 2 {
			t.Fatalf("reloaded state: %+v, %d events", st, len(evs))
		}
	})
	p, err := store.LoadProject(home, "p1")
	if err != nil {
		t.Fatal(err)
	}
	if p == nil || p.ActiveSessionID != s.ID() {
		t.Fatalf("project = %+v", p)
	}
	infos, err := m2.Sessions("p1")
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 1 || !infos[0].Active || infos[0].Title != "Idea" {
		t.Fatalf("infos = %+v", infos)
	}
}

func TestExecuteBatchIsAtomic(t *testing.T) {
	home := t.TempDir()
	m := newManager(t, home)
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Execute(&domain.AddStage{Title: "A"}, &domain.AddThread{StageID: "st_9", Title: "x"})
	var de *domain.Error
	if !errors.As(err, &de) || de.Code != domain.CodeStageNotFound {
		t.Fatalf("err = %v", err)
	}
	s.Read(func(st *domain.State, evs []domain.Event) {
		if len(st.Stages) != 0 || len(evs) != 1 {
			t.Fatalf("partial batch leaked: %d stages, %d events", len(st.Stages), len(evs))
		}
	})
	m.Close()
	s2, err := newManager(t, home).Get(s.ID())
	if err != nil {
		t.Fatal(err)
	}
	s2.Read(func(st *domain.State, evs []domain.Event) {
		if len(evs) != 1 {
			t.Fatalf("partial batch persisted: %d events", len(evs))
		}
	})
}

// Review Focus 4: concurrent writers get strictly increasing seqs and a reloadable log.
func TestConcurrentExecute(t *testing.T) {
	home := t.TempDir()
	m := newManager(t, home)
	s, err := m.Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Execute(&domain.AddStage{Title: "A"}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	s.Read(func(st *domain.State, evs []domain.Event) {
		for i, e := range evs {
			if e.Seq != int64(i+1) {
				t.Fatalf("event %d has seq %d", i, e.Seq)
			}
		}
		if len(st.Stages) != 20 {
			t.Fatalf("stages = %d", len(st.Stages))
		}
	})
	m.Close()
	s2, err := newManager(t, home).Get(s.ID())
	if err != nil {
		t.Fatal(err)
	}
	s2.Read(func(_ *domain.State, evs []domain.Event) {
		if len(evs) != 21 {
			t.Fatalf("reloaded %d events", len(evs))
		}
	})
}

func TestChangedClosesOnExecute(t *testing.T) {
	s, err := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	ch := s.Changed()
	if _, err := s.Execute(&domain.AddStage{Title: "A"}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ch:
	default:
		t.Fatal("Changed channel not closed")
	}
}

func TestGetUnknownSession(t *testing.T) {
	_, err := newManager(t, t.TempDir()).Get("s_nope00")
	var de *domain.Error
	if !errors.As(err, &de) || de.Code != domain.CodeSessionNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestStoreContentMovesToBlob(t *testing.T) {
	s, err := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	cmd := &domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "a.kt", Content: "a\nb\n", FirstLine: 5},
		Variants: &domain.Variants{Options: []domain.VariantOption{{Title: "x", Blocks: []domain.BlockContent{{Kind: domain.KindMarkdown, Path: "d.md", Content: "# h\n"}}}}}}
	if err := s.StoreContent(cmd); err != nil {
		t.Fatal(err)
	}
	if cmd.Content != "" || cmd.LineCount != 2 || cmd.FirstLine != 5 || cmd.BlobSHA == "" {
		t.Fatalf("top block = %+v", cmd.BlockContent)
	}
	nested := cmd.Variants.Options[0].Blocks[0]
	if nested.Content != "" || nested.LineCount != 1 || nested.FirstLine != 1 {
		t.Fatalf("nested block = %+v", nested)
	}
	if got, _ := s.Blob(cmd.BlobSHA); string(got) != "a\nb\n" {
		t.Fatalf("blob = %q", got)
	}
}

func TestStoreContentMovesDiffToBlob(t *testing.T) {
	s, err := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	diff := "@@ -1 +1 @@\n-a\n+b\n"
	cmd := &domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "a.kt", Content: "b\n", Diff: diff}}
	if err := s.StoreContent(cmd); err != nil {
		t.Fatal(err)
	}
	if cmd.Diff != "" || cmd.DiffSHA == "" {
		t.Fatalf("block = %+v", cmd.BlockContent)
	}
	if got, _ := s.Blob(cmd.DiffSHA); string(got) != diff {
		t.Fatalf("diff blob = %q", got)
	}
}

// A quote on a file block must be in the commented lines of its blob, which only the daemon reads.
func TestExecuteChecksFileQuotes(t *testing.T) {
	s, err := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	file := &domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "a.kt", Content: "val a = 1\nval b = 2\n", FirstLine: 5}}
	if err := s.StoreContent(file); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Execute(&domain.AddStage{Title: "s"}, &domain.AddThread{Title: "t"}, file); err != nil {
		t.Fatal(err)
	}
	review := func(quote string) *domain.SubmitReview {
		return &domain.SubmitReview{Threads: []domain.ReviewThread{{ThreadID: "t_1", Comments: []domain.LineComment{
			{BlockID: "b_1", Lines: domain.LineRange{Start: 6, End: 6}, Quote: quote, Text: "why?"}}}}}
	}
	var de *domain.Error
	if _, err := s.Execute(review("val a")); !errors.As(err, &de) || de.Code != domain.CodeInvalidInput {
		t.Fatalf("quote outside the lines: %v", err)
	}
	if _, err := s.Execute(review("b = 2")); err != nil {
		t.Fatal(err)
	}
}

func TestMarkDelivered(t *testing.T) {
	s, err := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.MarkDelivered(1); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkDelivered(1); err != nil { // no-op: not beyond the cursor
		t.Fatal(err)
	}
	s.Read(func(st *domain.State, evs []domain.Event) {
		if st.Delivered != 1 || len(evs) != 2 || evs[1].Actor != domain.ActorSystem {
			t.Fatalf("delivered=%d events=%d", st.Delivered, len(evs))
		}
	})
}

// Review Focus 5: MarkDelivered must never mark an event that has not been written yet.
func TestMarkDeliveredClampsToLastSeq(t *testing.T) {
	s, err := newManager(t, t.TempDir()).Create(testProject, "Idea")
	if err != nil {
		t.Fatal(err)
	}
	var lastSeq int64
	s.Read(func(st *domain.State, _ []domain.Event) { lastSeq = st.LastSeq })

	if err := s.MarkDelivered(lastSeq + 1000); err != nil {
		t.Fatal(err)
	}
	s.Read(func(st *domain.State, _ []domain.Event) {
		if st.Delivered != lastSeq {
			t.Fatalf("delivered = %d, want clamped to lastSeq %d", st.Delivered, lastSeq)
		}
	})
}
