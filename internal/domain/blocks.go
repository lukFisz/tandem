package domain

type BlockKind string

const (
	KindNote     BlockKind = "note"
	KindCode     BlockKind = "code"
	KindFile     BlockKind = "file"
	KindMarkdown BlockKind = "markdown"
	KindVariants BlockKind = "variants"
)

// BlockContent is the renderable content of a block; blocks nested in variant options use it too.
type BlockContent struct {
	Kind      BlockKind `json:"type"`
	Lang      string    `json:"lang,omitempty"`
	Text      string    `json:"text,omitempty"`
	Path      string    `json:"path,omitempty"`
	BlobSHA   string    `json:"blobSha,omitempty"`
	FirstLine int       `json:"firstLine,omitempty"`
	LineCount int       `json:"lineCount,omitempty"`
	// DiffSHA is a blob holding the file's unified diff against git HEAD (full context, new-file line
	// numbers) as of the snapshot; empty when the file was clean or no diff could be captured.
	DiffSHA string `json:"diffSha,omitempty"`
	// Content and Diff are transport-only: the CLI sends file excerpts and their diff here and the
	// daemon moves them into blobs before Decide, which rejects commands that still carry them.
	Content string `json:"content,omitempty"`
	Diff    string `json:"diff,omitempty"`
}

// Annotatable reports whether line annotations and line comments may target this content.
func (c BlockContent) Annotatable() bool {
	return c.Kind == KindCode || c.Kind == KindFile || c.Kind == KindMarkdown || c.Kind == KindNote
}

type Variants struct {
	Title   string          `json:"title,omitempty"`
	Options []VariantOption `json:"options"`
}

type VariantOption struct {
	ID          string         `json:"id,omitempty"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Pros        []string       `json:"pros,omitempty"`
	Cons        []string       `json:"cons,omitempty"`
	Blocks      []BlockContent `json:"blocks,omitempty"`
}

func (v *Variants) Option(id string) *VariantOption {
	if v == nil {
		return nil
	}
	for i := range v.Options {
		if v.Options[i].ID == id {
			return &v.Options[i]
		}
	}
	return nil
}
