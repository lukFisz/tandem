package domain

import "encoding/json"

type Command interface{ isCommand() }

// Agent commands.

type AddStage struct {
	Title string `json:"title"`
	Goal  string `json:"goal,omitempty"`
}

type AddThread struct {
	StageID string `json:"stageId,omitempty"`
	Title   string `json:"title"`
}

type AddBlock struct {
	ThreadID   string `json:"threadId,omitempty"`
	Supersedes string `json:"supersedes,omitempty"`
	BlockContent
	Variants *Variants `json:"variants,omitempty"`
}

type Annotate struct {
	BlockID string    `json:"blockId"`
	Lines   LineRange `json:"lines"`
	Text    string    `json:"text"`
}

// Say posts the AI's chat message to a thread (ThreadID, or the latest open thread when both ids
// are empty) or to a stage page (StageID, stage summary flow spec part E). Setting both is an error.
type Say struct {
	ThreadID string `json:"threadId,omitempty"`
	StageID  string `json:"stageId,omitempty"`
	Text     string `json:"text"`
}

type Conclude struct {
	ThreadID string `json:"threadId,omitempty"`
	Text     string `json:"text"`
}

type ProposeStageSummary struct {
	StageID string `json:"stageId,omitempty"`
	Text    string `json:"text"`
}

type CloseSession struct{}

// Ask posts a question with 2–4 answer buttons; the answer arrives through `tdm wait`. It goes to a
// thread (ThreadID, or the latest open thread when both ids are empty) or to a stage page (StageID,
// demo 7 follow-ups 6). Setting both is an error.
type Ask struct {
	ThreadID string   `json:"threadId,omitempty"`
	StageID  string   `json:"stageId,omitempty"`
	Text     string   `json:"text"`
	Options  []string `json:"options"`
}

// WithdrawQuestion withdraws an open question the conversation has made moot.
type WithdrawQuestion struct {
	QuestionID string `json:"questionId"`
}

// StartProcess attaches a PID the agent already started to a thread card.
type StartProcess struct {
	ThreadID string `json:"threadId,omitempty"`
	PID      int    `json:"pid"`
	Cmd      string `json:"cmd"`
	// Out is the absolute path of the file the command writes its output to, if any; the daemon
	// tails it to show the last lines on the card.
	Out string `json:"out,omitempty"`
}

// EndProcess records the exit code of a running process.
//
// Supervised is set only by the hidden `tdm process supervise` helper behind `tdm process run`: it
// watched the command itself, so the exit is recorded as a system (daemon-observed) event that
// wakes `tdm wait`, like one the PID poller detects. The agent's own `tdm process end` never does.
type EndProcess struct {
	ID         string `json:"id"`
	ExitCode   int    `json:"exitCode"`
	Supervised bool   `json:"supervised,omitempty"`
}

// User commands (sent by the web UI).

type SubmitReview struct {
	Threads []ReviewThread `json:"threads"`
}

type ChooseVariant struct {
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
	Comment  string `json:"comment,omitempty"`
	// Resolve also resolves the thread, with the option title (plus the comment) as its conclusion.
	Resolve bool `json:"resolve,omitempty"`
}

// ResolveThread resolves a thread from the user's side, whether or not a conclusion is proposed.
// An empty text resolves it with UserResolvedText.
type ResolveThread struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text,omitempty"`
}

// UserResolvedText is the conclusion of a thread the user resolved without a note.
const UserResolvedText = "Resolved by user"

type RejectVariants struct {
	BlockID string `json:"blockId"`
	Comment string `json:"comment"`
}

type AcceptConclusion struct {
	ThreadID string `json:"threadId"`
}

type EditConclusion struct {
	ThreadID string `json:"threadId"`
	Text     string `json:"text"`
}

// ReviseConclusion is Save in a proposed conclusion's Edit editor (stage summary flow, part C): the
// user's text replaces the proposal, and the thread stays proposed until Accept. EditConclusion
// (edit and accept in one step) stays for old clients; the UI no longer sends it. BaseVersion is the
// proposalVersion the user was editing: a Save against an older version is rejected with
// proposal_changed, so it never replaces a proposal the user has not seen. 0 skips the check.
type ReviseConclusion struct {
	ThreadID    string `json:"threadId"`
	Text        string `json:"text"`
	BaseVersion int    `json:"baseVersion,omitempty"`
}

type RequestDiscussion struct {
	ThreadID string `json:"threadId"`
	Comment  string `json:"comment"`
}

// AcceptStageSummary accepts the proposed stage summary. A Text that differs from the proposal
// (after trimming) is the user's edit (demo2 follow-up 7): it becomes the summary, and the agent
// reads "stage summary — edited and accepted". A blank or unchanged Text is a plain accept.
type AcceptStageSummary struct {
	StageID string `json:"stageId"`
	Text    string `json:"text,omitempty"`
}

// ReviseStageSummary is Save in a proposed stage summary's Edit editor: the same as ReviseConclusion,
// for a stage. AcceptStageSummary with a Text stays for old clients; the UI no longer sends it.
type ReviseStageSummary struct {
	StageID     string `json:"stageId"`
	Text        string `json:"text"`
	BaseVersion int    `json:"baseVersion,omitempty"`
}

// PostStageMessage is the user's message on a stage page (stage summary flow spec, part E). It is
// how the user asks for changes to a proposed summary, and any stage takes it, an accepted one too.
type PostStageMessage struct {
	StageID string `json:"stageId"`
	Text    string `json:"text"`
}

type EndSession struct {
	Comment string `json:"comment,omitempty"`
}

// AnswerQuestion answers an open question with exactly one of an option or the user's own text.
type AnswerQuestion struct {
	QuestionID string `json:"questionId"`
	OptionID   string `json:"optionId,omitempty"`
	Other      string `json:"other,omitempty"`
}

func (*AddStage) isCommand()            {}
func (*AddThread) isCommand()           {}
func (*AddBlock) isCommand()            {}
func (*Annotate) isCommand()            {}
func (*Say) isCommand()                 {}
func (*Conclude) isCommand()            {}
func (*ProposeStageSummary) isCommand() {}
func (*CloseSession) isCommand()        {}
func (*SubmitReview) isCommand()        {}
func (*ChooseVariant) isCommand()       {}
func (*ResolveThread) isCommand()       {}
func (*RejectVariants) isCommand()      {}
func (*AcceptConclusion) isCommand()    {}
func (*EditConclusion) isCommand()      {}
func (*RequestDiscussion) isCommand()   {}
func (*AcceptStageSummary) isCommand()  {}
func (*ReviseConclusion) isCommand()    {}
func (*ReviseStageSummary) isCommand()  {}
func (*PostStageMessage) isCommand()    {}
func (*EndSession) isCommand()          {}
func (*Ask) isCommand()                 {}
func (*WithdrawQuestion) isCommand()    {}
func (*AnswerQuestion) isCommand()      {}
func (*StartProcess) isCommand()        {}
func (*EndProcess) isCommand()          {}

var commandFactories = map[Actor]map[string]func() Command{
	ActorAI: {
		"stage.add":         func() Command { return &AddStage{} },
		"thread.add":        func() Command { return &AddThread{} },
		"block.add":         func() Command { return &AddBlock{} },
		"annotate":          func() Command { return &Annotate{} },
		"say":               func() Command { return &Say{} },
		"conclude":          func() Command { return &Conclude{} },
		"stage.propose":     func() Command { return &ProposeStageSummary{} },
		"session.close":     func() Command { return &CloseSession{} },
		"ask":               func() Command { return &Ask{} },
		"question.withdraw": func() Command { return &WithdrawQuestion{} },
		"process.start":     func() Command { return &StartProcess{} },
		"process.end":       func() Command { return &EndProcess{} },
	},
	ActorUser: {
		"review.submit":      func() Command { return &SubmitReview{} },
		"question.answer":    func() Command { return &AnswerQuestion{} },
		"variant.choose":     func() Command { return &ChooseVariant{} },
		"thread.resolve":     func() Command { return &ResolveThread{} },
		"variants.reject":    func() Command { return &RejectVariants{} },
		"conclusion.accept":  func() Command { return &AcceptConclusion{} },
		"conclusion.edit":    func() Command { return &EditConclusion{} },
		"conclusion.discuss": func() Command { return &RequestDiscussion{} },
		"conclusion.revise":  func() Command { return &ReviseConclusion{} },
		"stage.accept":       func() Command { return &AcceptStageSummary{} },
		"stage.revise":       func() Command { return &ReviseStageSummary{} },
		"stage.message":      func() Command { return &PostStageMessage{} },
		"session.end":        func() Command { return &EndSession{} },
	},
}

// DecodeCommand turns a wire command {type, data} into a typed command the actor may send.
func DecodeCommand(actor Actor, typ string, data json.RawMessage) (Command, error) {
	f := commandFactories[actor][typ]
	if f == nil {
		return nil, errorf(CodeInvalidCommand, "", "unknown %s command %q", actor, typ)
	}
	cmd := f()
	if len(data) > 0 {
		if err := json.Unmarshal(data, cmd); err != nil {
			return nil, errorf(CodeInvalidInput, "", "decode %s: %v", typ, err)
		}
	}
	return cmd, nil
}
