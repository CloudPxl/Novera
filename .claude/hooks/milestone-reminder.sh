#!/usr/bin/env bash
# PostToolUse/Bash hook: after a git commit, remind Claude to keep the project
# context files current so a future session can reload cheaply.
# Silent (exit 0, no output) for every Bash call that is not a commit.
set -uo pipefail

cmd="$(jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
grep -qE '(^|[;&|] *)git( -[^ ]+ [^ ]+)* +commit' <<<"$cmd" || exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Commit made. If it closed a milestone or changed the project's shape: append one dated line to docs/DECISIONS.md and refresh the Status section of CLAUDE.md. If it was a routine commit, do nothing and do not mention this."},"suppressOutput":true}
JSON
