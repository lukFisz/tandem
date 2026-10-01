package daemon

import (
	"fmt"

	"github.com/lukFisz/tandem/internal/domain"
)

// StoreContent moves the transport-only Content of an AddBlock (and its variant blocks) into blobs.
func (s *Session) StoreContent(cmd domain.Command) error {
	ab, ok := cmd.(*domain.AddBlock)
	if !ok {
		return nil
	}
	if err := s.storeOne(&ab.BlockContent); err != nil {
		return err
	}
	if ab.Variants == nil {
		return nil
	}
	for i := range ab.Variants.Options {
		for j := range ab.Variants.Options[i].Blocks {
			if err := s.storeOne(&ab.Variants.Options[i].Blocks[j]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Session) storeOne(c *domain.BlockContent) error {
	if c.Diff != "" {
		sha, err := s.PutBlob([]byte(c.Diff))
		if err != nil {
			return err
		}
		c.DiffSHA, c.Diff = sha, ""
	}
	if c.Content == "" {
		return nil
	}
	sha, err := s.PutBlob([]byte(c.Content))
	if err != nil {
		return err
	}
	c.BlobSHA, c.LineCount, c.FirstLine, c.Content = sha, domain.CountLines(c.Content), max(c.FirstLine, 1), ""
	return nil
}

// checkFileQuotes rejects a review whose quote on a file block is not in the commented lines of the
// block's blob. Decide checks everything else; it cannot read blobs. Callers hold s.mu.
func (s *Session) checkFileQuotes(cmd domain.Command) error {
	r, ok := cmd.(*domain.SubmitReview)
	if !ok {
		return nil
	}
	for _, rt := range r.Threads {
		for _, c := range rt.Comments {
			b := s.state.Blocks[c.BlockID]
			if c.Quote == "" || b == nil || b.Kind != domain.KindFile || !c.Lines.Within(b.FirstLine, b.LineCount) {
				continue
			}
			data, err := s.Blob(b.BlobSHA)
			if err != nil {
				return fmt.Errorf("block %s: %w", b.ID, err)
			}
			if !domain.QuoteInLines(string(data), b.FirstLine, c.Lines, c.Quote) {
				return domain.QuoteNotFound(b.ID, c.Lines)
			}
		}
	}
	return nil
}
