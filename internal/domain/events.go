package domain

const (
	EvSessionCreated                = "session.created"
	EvSessionClosed                 = "session.closed"
	EvSessionEndRequested           = "session.end_requested"
	EvStageCreated                  = "stage.created"
	EvStageSummaryProposed          = "stage.summary.proposed"
	EvStageSummaryAccepted          = "stage.summary.accepted"
	EvStageSummaryChangesRequested  = "stage.summary.changes_requested"
	EvThreadCreated                 = "thread.created"
	EvBlockAdded                    = "block.added"
	EvAnnotationAdded               = "annotation.added"
	EvMessagePosted                 = "message.posted"
	EvConclusionProposed            = "conclusion.proposed"
	EvConclusionAccepted            = "conclusion.accepted"
	EvConclusionEdited              = "conclusion.edited"
	EvConclusionDiscussionRequested = "conclusion.discussion_requested"
	EvConclusionRevised             = "conclusion.revised"
	EvSummaryRevised                = "summary.revised"
	EvReviewSubmitted               = "review.submitted"
	EvVariantChosen                 = "variant.chosen"
	EvVariantsRejected              = "variants.rejected"
	EvAgentDelivered                = "agent.delivered"
	EvQuestionAsked                 = "question.asked"
	EvQuestionAnswered              = "question.answered"
	EvQuestionWithdrawn             = "question.withdrawn"
	EvProcessStarted                = "process.started"
	EvProcessExited                 = "process.exited"
)

type SessionCreated struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	ProjectID string `json:"projectId"`
}

// SessionClosedPayload is the payload for EvSessionClosed. It is named
// "...Payload" to avoid colliding with the SessionClosed status constant.
type SessionClosedPayload struct{}

type SessionEndRequested struct {
	Comment string `json:"comment,omitempty"`
}

type StageCreated struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Goal  string `json:"goal,omitempty"`
}

// StageSummaryProposedPayload is the payload for EvStageSummaryProposed. It is named
// "...Payload" to avoid colliding with the StageSummaryProposed status constant.
type StageSummaryProposedPayload struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}

// StageSummaryAccepted is the accepted stage summary. Original is the AI's proposal when the user
// edited it before accepting; it is empty for a plain accept, and in every log written before
// summaries could be edited, which therefore replay unchanged.
type StageSummaryAccepted struct {
	StageID  string `json:"stageId"`
	Text     string `json:"text"`
	Original string `json:"original,omitempty"`
}

// StageSummaryChangesRequested is legacy: the UI's "Request changes" button was replaced by a
// stage message (stage summary flow spec, part E), so nothing produces this event any more. The
// reducer still replays it so logs written before that change load.
type StageSummaryChangesRequested struct {
	StageID string `json:"stageId"`
	Comment string `json:"comment"`
}

type ThreadCreated struct {
	ID      string `json:"id"`
	StageID string `json:"stageId"`
	Title   string `json:"title"`
}

type BlockAdded struct {
	ID         string `json:"id"`
	ThreadID   string `json:"threadId"`
	Supersedes string `json:"supersedes,omitempty"`
	BlockContent
	Variants *Variants `json:"variants,omitempty"`
}

type AnnotationAdded struct {
	BlockID string    `json:"blockId"`
	Lines   LineRange `json:"lines"`
	Text    string    `json:"text"`
}

// MessagePosted is a chat message with exactly one of ThreadID and StageID. In a thread it is the
// AI's (user thread messages arrive inside ReviewSubmitted). On a stage page it is either side's,
// told apart by the event's actor (stage summary flow spec, part E). Both ids are omitempty, so a
// thread message marshals exactly as it did before stage messages existed.
type MessagePosted struct {
	ThreadID string `json:"threadId,omitempty"`
	StageID  string `json:"stageId,omitempty"`
	Text     string `json:"text"`
}

type ConclusionProposed struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

type ConclusionAccepted struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

type ConclusionEdited struct {
	ThreadID string `json:"threadId"`
	Original string `json:"original"`
	Text     string `json:"text"`
}

// ConclusionRevised is the user's saved edit of a proposed conclusion: Text (trimmed) replaces the
// proposal, and the thread stays proposed (stage summary flow, part C).
type ConclusionRevised struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

// SummaryRevised is the same for a proposed stage summary.
type SummaryRevised struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}

type ConclusionDiscussionRequested struct {
	ThreadID string `json:"threadId"`
	Comment  string `json:"comment"`
}

type ReviewSubmitted struct {
	Threads []ReviewThread `json:"threads"`
}

type ReviewThread struct {
	ThreadID        string           `json:"threadId"`
	Comments        []LineComment    `json:"comments,omitempty"`
	MessageComments []MessageComment `json:"messageComments,omitempty"`
	Message         string           `json:"message,omitempty"`
}

// LineComment is a comment on lines of a block. Quote, when set, is the text the user selected
// within those lines; a comment without it reads exactly as before quotes existed.
type LineComment struct {
	BlockID string    `json:"blockId"`
	Lines   LineRange `json:"lines"`
	Quote   string    `json:"quote,omitempty"`
	Text    string    `json:"text"`
}

// MessageComment is a comment on text selected in a thread's chat message, named by its seq.
type MessageComment struct {
	MessageSeq int64  `json:"messageSeq"`
	Quote      string `json:"quote"`
	Text       string `json:"text"`
}

type VariantChosen struct {
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
	Comment  string `json:"comment,omitempty"`
	// Conclusion is set when the choice also resolved the thread ("Choose & resolve").
	Conclusion string `json:"conclusion,omitempty"`
}

type VariantsRejected struct {
	ThreadID string `json:"threadId"`
	BlockID  string `json:"blockId"`
	Comment  string `json:"comment"`
}

type AgentDelivered struct {
	UpTo int64 `json:"upTo"`
}

// QuestionAsked is an AI message with 2–4 answer buttons (question message spec). Its option ids
// come from the o_N counter shared with variants. The question events carry exactly one of
// ThreadID and StageID (a stage page question, demo 7 follow-ups 6). Both ids are omitempty, so a
// thread question marshals exactly as it did before stage questions existed.
type QuestionAsked struct {
	ThreadID   string           `json:"threadId,omitempty"`
	StageID    string           `json:"stageId,omitempty"`
	QuestionID string           `json:"questionId"`
	Text       string           `json:"text"`
	Options    []QuestionOption `json:"options"`
}

// QuestionAnswered carries exactly one of OptionID and Other. ThreadID is not in the spec's
// table; it is carried like variant.chosen's, so EventThreadIDs, `tdm wait` and `tdm log --stage`
// place the event without a lookup.
type QuestionAnswered struct {
	ThreadID   string `json:"threadId,omitempty"`
	StageID    string `json:"stageId,omitempty"`
	QuestionID string `json:"questionId"`
	OptionID   string `json:"optionId,omitempty"`
	Other      string `json:"other,omitempty"`
}

type QuestionWithdrawn struct {
	ThreadID   string `json:"threadId,omitempty"`
	StageID    string `json:"stageId,omitempty"`
	QuestionID string `json:"questionId"`
}

type ProcessStarted struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
	PID      int    `json:"pid"`
	Cmd      string `json:"cmd"`
	Out      string `json:"out,omitempty"`
}

// ProcessExitedPayload is the payload for EvProcessExited. It is named
// "...Payload" to avoid colliding with the ProcessExited status constant.
type ProcessExitedPayload struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
	ExitCode int    `json:"exitCode"`
}
