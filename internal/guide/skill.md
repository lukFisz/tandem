---
name: tandem
description: Use when the user wants to review, brainstorm or refine large AI output (code, documents, plans) with you interactively in the browser, thread by thread, or mentions Tandem or tdm. Drives the local `tdm` CLI.
---

# Tandem — interactive review sessions

Before your first `tdm` command in a conversation, run `tdm guide` and follow it exactly.
The guide is versioned with the binary, so always read it instead of relying on memory.

`tdm wait` waits up to 9 minutes by default, so it needs no `--timeout`. Your shell tool may kill commands sooner:
run `tdm wait` with that tool's timeout raised to its maximum (600000 ms in Claude Code). Only if your tool cannot
allow 9 minutes, pass `--timeout` below its cap.
