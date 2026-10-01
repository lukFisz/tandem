package daemon

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/lukaszfiszer/tandem/internal/domain"
	"github.com/lukaszfiszer/tandem/internal/store"
)

var updateFixture = flag.Bool("update", false, "rewrite web/src/test/fixtures/snapshot.json")

const fixturePath = "../../web/src/test/fixtures/snapshot.json"

// TestSnapshotContractFixture pins the JSON the web UI receives. The web tests load the same file,
// so a Go-side change to the snapshot shape fails here first and is then caught by the web tests.
func TestSnapshotContractFixture(t *testing.T) {
	m := newManager(t, t.TempDir())
	s, err := m.Create(store.Project{ID: "p_fixture", RootPath: "/work/demo", Name: "demo"}, "Implement idea ABC")
	if err != nil {
		t.Fatal(err)
	}
	run := func(c domain.Command) {
		t.Helper()
		if err := s.StoreContent(c); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Execute(c); err != nil {
			t.Fatalf("%T: %v", c, err)
		}
	}
	lines := func(a, b int) domain.LineRange { return domain.LineRange{Start: a, End: b} }

	run(&domain.AddStage{Title: "Data model", Goal: "Pick the storage layer"})
	run(&domain.AddThread{Title: "Repository layer"})
	run(&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindNote,
		Text: "The repository isolates storage from the domain, so the **event log** format can change freely."}})
	run(&domain.AddBlock{BlockContent: domain.BlockContent{Kind: domain.KindFile, Path: "src/Repo.kt", Lang: "kotlin",
		Content: "class Repo(\n    val db: Db,\n    val cache: Map<String, User>? = null\n)\n", FirstLine: 12}})
	run(&domain.Annotate{BlockID: "b_2", Lines: lines(14, 14), Text: "Nullable because the cache is built lazily."})
	run(&domain.Say{ThreadID: "t_1", Text: "Here is the repository layer."})
	run(&domain.AddThread{Title: "Cache strategy"})
	run(&domain.AddBlock{ThreadID: "t_2", BlockContent: domain.BlockContent{Kind: domain.KindVariants},
		Variants: &domain.Variants{Title: "Pick an approach for the cache", Options: []domain.VariantOption{
			{Title: "Empty map", Pros: []string{"No null checks"}, Cons: []string{"Eager allocation"},
				Blocks: []domain.BlockContent{{Kind: domain.KindCode, Lang: "kotlin", Text: "val cache = mutableMapOf<String, User>()\n"}}},
			{Title: "Lazy delegate", Description: "Build the map on first use.", Pros: []string{"Built on demand", "Non-null type"}},
		}}})
	run(&domain.AddThread{Title: "Docs"})
	run(&domain.AddBlock{ThreadID: "t_3", BlockContent: domain.BlockContent{Kind: domain.KindMarkdown,
		Text: "# Storage\n\nWe keep an event log.\n\n- JSONL\n- blobs\n"}})
	run(&domain.AddBlock{ThreadID: "t_3", BlockContent: domain.BlockContent{Kind: domain.KindCode, Lang: "go", Text: "x := 1\n"}})
	run(&domain.AddBlock{ThreadID: "t_3", Supersedes: "b_5", BlockContent: domain.BlockContent{Kind: domain.KindCode, Lang: "go", Text: "x := 2\n"}})
	run(&domain.AddStage{Title: "API"})
	run(&domain.SubmitReview{Threads: []domain.ReviewThread{{ThreadID: "t_1",
		Comments: []domain.LineComment{{BlockID: "b_2", Lines: lines(14, 14), Text: "Why not an empty map?"},
			{BlockID: "b_2", Lines: lines(13, 13), Quote: "db: Db", Text: "Which Db?"}},
		MessageComments: []domain.MessageComment{{MessageSeq: 7, Quote: "repository layer", Text: "Which one?"}},
		Message:         "Overall fine."}}})
	run(&domain.ChooseVariant{BlockID: "b_3", OptionID: "o_2", Comment: "Simpler."})
	run(&domain.Conclude{ThreadID: "t_2", Text: "Use a lazy delegate for the cache."})
	run(&domain.Ask{ThreadID: "t_3", Text: "Should the docs cover the blob layout?", Options: []string{"Yes", "No"}})
	run(&domain.WithdrawQuestion{QuestionID: "q_1"})
	// Demo 6 follow-ups 1: an answered question and its linked answer message. A two-line question
	// pins that headers show the first line. The AI's reply after it keeps t_2's user messages
	// delivered (msg.seq <= lastAiSeq), as before.
	run(&domain.Ask{ThreadID: "t_2", Text: "Cache user lookups too?\nOnly the hot paths.", Options: []string{"Yes", "No"}})
	run(&domain.AnswerQuestion{QuestionID: "q_2", OptionID: "o_5"})
	run(&domain.Say{ThreadID: "t_2", Text: "Noted: user lookups are cached too."})
	// Stage summary flow spec, part E: a stage conversation (seqs 23 and 24), so the web tests see
	// Stage.messages, lastAiSeq and lastUserSeq. t_2's conclusion (seq 17) is proposal v1.
	run(&domain.Say{StageID: "st_2", Text: "Next we pick the API style."})
	run(&domain.PostStageMessage{StageID: "st_2", Text: "REST, please."})

	snap, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	snap = bytes.ReplaceAll(snap, []byte(s.ID()), []byte("s_fixture"))
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, snap, "", "  "); err != nil {
		t.Fatal(err)
	}
	pretty.WriteByte('\n')

	if *updateFixture {
		if err := os.MkdirAll(filepath.Dir(fixturePath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fixturePath, pretty.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(fixturePath)
	if err != nil || !bytes.Equal(want, pretty.Bytes()) {
		t.Fatalf("snapshot JSON differs from %s (err=%v).\nIf the change is intended run:\n  go test ./internal/daemon -run TestSnapshotContractFixture -update\nthen update web/src/api/types.ts and the web tests.", fixturePath, err)
	}
}
