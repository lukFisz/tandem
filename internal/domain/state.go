package domain

type SessionStatus string
type StageStatus string
type ThreadStatus string

const (
	SessionActive SessionStatus = "active"
	SessionClosed SessionStatus = "closed"

	StageOpen            StageStatus = "open"
	StageSummaryProposed StageStatus = "summary_proposed"
	StageAccepted        StageStatus = "accepted"

	ThreadOpen               ThreadStatus = "open"
	ThreadConclusionProposed ThreadStatus = "conclusion_proposed"
	ThreadResolved           ThreadStatus = "resolved"
)

// State is the fold of a session's events. It is also the JSON the web UI receives.
type State struct {
	Session       Session             `json:"session"`
	Stages        []*Stage            `json:"stages"`
	Threads       map[string]*Thread  `json:"threads"`
	Blocks        map[string]*Block   `json:"blocks"`
	LastSeq       int64               `json:"lastSeq"`
	LastAISeq     int64               `json:"lastAiSeq"`
	Delivered     int64               `json:"delivered"`
	EndRequested  bool                `json:"endRequested"`
	Processes     map[string]*Process `json:"processes,omitempty"`
	optionCount   int
	questionCount int
	processCount  int
	waitCount     int
}

type Session struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	ProjectID string        `json:"projectId"`
	Status    SessionStatus `json:"status"`
}

type Stage struct {
	ID              string      `json:"id"`
	Title           string      `json:"title"`
	Goal            string      `json:"goal,omitempty"`
	Status          StageStatus `json:"status"`
	ProposedSummary string      `json:"proposedSummary,omitempty"`
	EditedByUser    bool        `json:"editedByUser,omitempty"` // ProposedSummary is the user's saved edit (summary.revised)
	Summary         string      `json:"summary,omitempty"`
	// AcceptedSeq is the seq of the stage.summary.accepted event (derived, so old logs get it on
	// replay). The stage page keeps the accepted summary card where it was accepted in the timeline.
	AcceptedSeq int64    `json:"acceptedSeq,omitempty"`
	ThreadIDs   []string `json:"threadIds"`
	// The stage page's conversation (stage summary flow spec, part E), and the seqs that tell
	// whether the user's latest stage message still awaits the AI.
	Messages    []Message `json:"messages,omitempty"`
	LastUserSeq int64     `json:"lastUserSeq,omitempty"`
	LastAISeq   int64     `json:"lastAiSeq,omitempty"`
	// ProposalVersion counts the AI's summary proposals; Proposals keeps each one (part D).
	ProposalVersion int        `json:"proposalVersion,omitempty"`
	Proposals       []Proposal `json:"proposals,omitempty"`
}

// AwaitingAI reports whether the user messaged the stage after the AI's last action in it: a stage
// message, a summary proposal or a new thread, or, for an accepted stage, adding the stage after
// it (part E). Mirrors Thread.AwaitingAI.
func (st *Stage) AwaitingAI() bool {
	return st.LastUserSeq > st.LastAISeq
}

// Proposal is one AI proposal of a thread conclusion or a stage summary. Proposals[i] is version
// i+1. The UI lists the earlier versions in the timeline by Seq (stage summary flow spec, part D).
type Proposal struct {
	Text string `json:"text"`
	Seq  int64  `json:"seq"`
}

type Thread struct {
	ID                 string                 `json:"id"`
	StageID            string                 `json:"stageId"`
	Title              string                 `json:"title"`
	Status             ThreadStatus           `json:"status"`
	BlockIDs           []string               `json:"blockIds"`
	Messages           []Message              `json:"messages"`
	Comments           []ThreadComment        `json:"comments"`
	MessageComments    []ThreadMessageComment `json:"messageComments,omitempty"`
	ProposedConclusion string                 `json:"proposedConclusion,omitempty"`
	EditedByUser       bool                   `json:"editedByUser,omitempty"` // ProposedConclusion is the user's saved edit (conclusion.revised)
	Conclusion         string                 `json:"conclusion,omitempty"`
	LastUserSeq        int64                  `json:"lastUserSeq"`
	LastAISeq          int64                  `json:"lastAiSeq"`
	// ProposalVersion counts the AI's conclusion proposals; Proposals keeps each one (part D).
	ProposalVersion int        `json:"proposalVersion,omitempty"`
	Proposals       []Proposal `json:"proposals,omitempty"`
}

// ThreadComment is a line comment the user sent, with the seq of the review that sent it. The
// user message of that review has the same seq, which is how the UI links the two.
type ThreadComment struct {
	LineComment
	Seq int64 `json:"seq"`
}

// ThreadMessageComment is a message comment the user sent, with the seq of the review that sent it.
type ThreadMessageComment struct {
	MessageComment
	Seq int64 `json:"seq"`
}

func (t *Thread) hasMessage(seq int64) bool {
	for _, m := range t.Messages {
		if m.Seq == seq {
			return true
		}
	}
	return false
}

// AwaitingAI reports whether the user acted in this thread after the AI's last action.
func (t *Thread) AwaitingAI() bool {
	return t.Status != ThreadResolved && t.LastUserSeq > t.LastAISeq
}

type Message struct {
	Actor    Actor            `json:"actor"`
	Text     string           `json:"text"`
	Seq      int64            `json:"seq"`
	Choice   *MessageChoice   `json:"choice,omitempty"`
	Question *MessageQuestion `json:"question,omitempty"`
	AnswerTo string           `json:"answerTo,omitempty"` // the question (q_N) an answer message answers
}

// MessageChoice links a user message to the variant option chosen with it.
type MessageChoice struct {
	BlockID  string `json:"blockId"`
	OptionID string `json:"optionId"`
}

// MessageQuestion makes an AI message a question with answer buttons (question message spec).
// Answer and Withdrawn are final: at most one of them is ever set.
type MessageQuestion struct {
	ID        string           `json:"id"`
	Options   []QuestionOption `json:"options"`
	Answer    *QuestionAnswer  `json:"answer,omitempty"`
	Withdrawn bool             `json:"withdrawn,omitempty"`
}

type QuestionOption struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// QuestionAnswer holds exactly one of OptionID and Other.
type QuestionAnswer struct {
	OptionID string `json:"optionId,omitempty"`
	Other    string `json:"other,omitempty"`
}

// Open reports whether the question is neither answered nor withdrawn.
func (q *MessageQuestion) Open() bool {
	return q.Answer == nil && !q.Withdrawn
}

func (q *MessageQuestion) Option(id string) *QuestionOption {
	for i := range q.Options {
		if q.Options[i].ID == id {
			return &q.Options[i]
		}
	}
	return nil
}

// Question returns the message of question id with the thread or the stage it was asked in
// (exactly one of them is set), or nils when there is none.
func (s *State) Question(id string) (*Thread, *Stage, *Message) {
	for _, t := range s.Threads {
		if m := questionIn(t.Messages, id); m != nil {
			return t, nil, m
		}
	}
	for _, st := range s.Stages {
		if m := questionIn(st.Messages, id); m != nil {
			return nil, st, m
		}
	}
	return nil, nil, nil
}

func questionIn(msgs []Message, id string) *Message {
	for i := range msgs {
		if q := msgs[i].Question; q != nil && q.ID == id {
			return &msgs[i]
		}
	}
	return nil
}

// AnswerMessage is the user message an answer adds to the thread, like "Chose:" for a variant.
func AnswerMessage(q *MessageQuestion, a QuestionAnswer) string {
	if a.Other != "" {
		return `Answered: "` + a.Other + `"`
	}
	if o := q.Option(a.OptionID); o != nil {
		return "Answered: " + o.Title
	}
	return "Answered: " + a.OptionID
}

type ProcessStatus string

const (
	ProcessRunning ProcessStatus = "running"
	ProcessExited  ProcessStatus = "exited"
)

// Process is an agent-attached command shown as a timeline card. Live elapsed
// is not stored; the UI derives it from StartedAt until ExitedAt is set.
type Process struct {
	ID        string        `json:"id"`
	ThreadID  string        `json:"threadId"`
	PID       int           `json:"pid"`
	Cmd       string        `json:"cmd"`
	Out       string        `json:"out,omitempty"` // output file the daemon tails, if any
	Status    ProcessStatus `json:"status"`
	Seq       int64         `json:"seq"`
	StartedAt int64         `json:"startedAt"` // unix ms, from the started event's TS
	ExitCode  *int          `json:"exitCode,omitempty"`
	ExitedAt  int64         `json:"exitedAt,omitempty"`
}

// ExitUnknown reports that the daemon saw the PID vanish (exit code -1) and the agent has not
// yet recorded the real code.
func (p *Process) ExitUnknown() bool {
	return p.Status == ProcessExited && p.ExitCode != nil && *p.ExitCode == -1
}

type Block struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
	Seq      int64  `json:"seq"`
	BlockContent
	Variants     *Variants    `json:"variants,omitempty"`
	Annotations  []Annotation `json:"annotations,omitempty"`
	SupersededBy string       `json:"supersededBy,omitempty"`
	ChosenOption string       `json:"chosenOption,omitempty"`
	Rejected     bool         `json:"rejected,omitempty"`
}

type Annotation struct {
	Lines LineRange `json:"lines"`
	Text  string    `json:"text"`
}

func NewState() *State {
	return &State{Threads: map[string]*Thread{}, Blocks: map[string]*Block{}}
}

func (s *State) Process(id string) *Process {
	if s.Processes == nil {
		return nil
	}
	return s.Processes[id]
}

func (s *State) Stage(id string) *Stage {
	for _, st := range s.Stages {
		if st.ID == id {
			return st
		}
	}
	return nil
}

// WaitCount is the number of `tdm wait` returns delivered so far (agent.delivered events).
func (s *State) WaitCount() int { return s.waitCount }
