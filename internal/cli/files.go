package cli

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/lukFisz/tandem/internal/domain"
)

const maxFileSize = 1 << 20

// resolvePath makes p absolute with symlinks resolved, even when the file itself does not exist.
func resolvePath(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	if r, err := filepath.EvalSymlinks(abs); err == nil {
		return r, nil
	}
	if dir, err := filepath.EvalSymlinks(filepath.Dir(abs)); err == nil {
		return filepath.Join(dir, filepath.Base(abs)), nil
	}
	return abs, nil
}

// readExcerpt snapshots lines of a file inside the project root.
// It returns the root-relative slash path, the excerpt text (newline-terminated) and its first line number.
func readExcerpt(root, path, lines string) (string, string, int, error) {
	abs, err := resolvePath(path)
	if err != nil {
		return "", "", 0, err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", 0, &cliError{Code: "path_outside_project", Message: path + " is outside the project",
			Hint: "Tandem only snapshots files inside " + root}
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", "", 0, &cliError{Code: "file_not_found", Message: fmt.Sprintf("cannot read %s: %v", path, err),
			Hint: "check the path; it is resolved relative to the current directory"}
	}
	if info.Size() > maxFileSize {
		return "", "", 0, &cliError{Code: "file_too_large", Message: fmt.Sprintf("%s is larger than 1 MiB", path),
			Hint: "paste the relevant part as a block via stdin, e.g. `tdm block add code --lang <lang>`"}
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", "", 0, &cliError{Code: "file_not_found", Message: fmt.Sprintf("cannot read %s: %v", path, err),
			Hint: "check the path; it is resolved relative to the current directory"}
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return "", "", 0, &cliError{Code: "binary_file", Message: path + " looks binary",
			Hint: "Tandem snapshots text files only"}
	}
	all := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	r := domain.LineRange{Start: 1, End: len(all)}
	if lines != "" {
		if r, err = domain.ParseLineRange(lines); err != nil {
			return "", "", 0, &usageError{err.Error()}
		}
		if r.End > len(all) {
			return "", "", 0, &cliError{Code: domain.CodeInvalidInput, Message: fmt.Sprintf("lines %s are beyond the end of %s", r, path),
				Hint: fmt.Sprintf("%s has %d lines", path, len(all))}
		}
	}
	return filepath.ToSlash(rel), strings.Join(all[r.Start-1:r.End], "\n") + "\n", r.Start, nil
}

// captureDiff returns the unified diff (full context, new-file line numbers) of a root-relative file
// against git HEAD, or "" when the file is clean or anything goes wrong: it never fails the add.
// Untracked, non-ignored files are diffed against /dev/null, so every line counts as added.
func captureDiff(root, rel string) string {
	git := func(allowDiffExit bool, args ...string) (string, bool) {
		cmd := exec.Command("git", append([]string{"-C", root, "-c", "core.quotepath=off"}, args...)...)
		var out bytes.Buffer
		cmd.Stdout = &out
		err := cmd.Run()
		if ee, ok := err.(*exec.ExitError); ok && allowDiffExit && ee.ExitCode() == 1 {
			err = nil
		}
		return out.String(), err == nil
	}
	if _, ok := git(false, "rev-parse", "--verify", "-q", "HEAD"); !ok {
		return ""
	}
	const diffArgs = "--no-color --no-ext-diff --no-textconv --unified=999999"
	flags := strings.Fields(diffArgs)
	var out string
	if _, tracked := git(false, "ls-files", "--error-unmatch", "--", rel); tracked {
		out, _ = git(false, append(append([]string{"diff", "HEAD"}, flags...), "--", rel)...)
	} else if _, ignored := git(false, "check-ignore", "-q", "--", rel); !ignored {
		out, _ = git(true, append(append([]string{"diff", "--no-index"}, flags...), "--", "/dev/null", rel)...)
	}
	if len(out) > 4*maxFileSize {
		return ""
	}
	return out
}
