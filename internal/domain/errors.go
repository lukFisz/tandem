package domain

import (
	"fmt"
	"strings"
)

const (
	CodeInvalidCommand       = "invalid_command"
	CodeInvalidInput         = "invalid_input"
	CodeSessionClosed        = "session_closed"
	CodeSessionNotFound      = "session_not_found"
	CodeProjectNotFound      = "project_not_found"
	CodeStageNotFound        = "stage_not_found"
	CodeThreadNotFound       = "thread_not_found"
	CodeBlockNotFound        = "block_not_found"
	CodeOptionNotFound       = "option_not_found"
	CodeNoOpenStage          = "no_open_stage"
	CodeNoOpenThread         = "no_open_thread"
	CodeStageNotOpen         = "stage_not_open"
	CodeThreadResolved       = "thread_resolved"
	CodeThreadsUnresolved    = "threads_unresolved"
	CodeNoConclusionProposed = "no_conclusion_proposed"
	CodeNoSummaryProposed    = "no_summary_proposed"
	CodeQuestionNotFound     = "question_not_found"
	CodeQuestionClosed       = "question_closed"
	CodeProcessNotFound      = "process_not_found"
	CodeProcessExited        = "process_exited"
	CodeTextUnchanged        = "text_unchanged"
	CodeProposalChanged      = "proposal_changed"
)

// Error is a rule violation the caller can act on; Hint tells an agent how to recover.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func (e *Error) NotFound() bool { return strings.HasSuffix(e.Code, "_not_found") }

func errorf(code, hint, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...), Hint: hint}
}

// SessionClosedError is the error a closed session answers with, whether the caller is Decide
// (an agent command) or the daemon's /wait handler (final review finding 5: without this, `Tandem
// wait` on a closed session only times out, and the guide's "exit 3 → wait again" would loop
// forever instead of ever telling the agent the session is done).
func SessionClosedError(sessionID string) *Error {
	return errorf(CodeSessionClosed, "start a new session with `tdm session new \"<title>\"`", "session %s is closed", sessionID)
}

func required(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return errorf(CodeInvalidInput, "", "%s is required", field)
	}
	return nil
}
