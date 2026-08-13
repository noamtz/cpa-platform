# Codex hooks

The project registers two hooks in `.codex/hooks.json`:

- `pre_tool_use.py` blocks obvious access to secret files or environment dumps, recursive force-deletion commands,
  the forbidden GitHub identity, bare `gh` calls that bypass the repository wrapper, and GitHub MCP calls when
  `origin` is not `git@github.com:noamtz/cpa-platform.git`.
- `post_tool_use.py` appends shell and edit events to the ignored `.codex/logs/tool-events.jsonl` file.

The registered commands use this project's absolute path, and the audit hook resolves
the log directory from its own script path. Both hooks therefore work even when Codex
starts the hook process outside the Git worktree. If the project is moved, update both
paths in `.codex/hooks.json` and trust the changed definitions again.

Codex does not automatically trust project command hooks. Start a new Codex session, open `/hooks`, review the exact definitions and scripts, and explicitly trust them before relying on the guardrail.

Test the pre-hook directly from PowerShell:

```powershell
'{"tool_name":"Bash","tool_input":{"command":"Get-Content .env"}}' |
  uv run --script .codex/hooks/pre_tool_use.py
$LASTEXITCODE # expected: 0
```

The blocked case returns a JSON `PreToolUse` denial on stdout; an ordinary command
returns no output. Both exit `0` because Codex consumes the structured decision.
Hook failures intentionally fail open; this is a focused guardrail, not a complete
security boundary. Codex sandboxing, approval policy, repository trust, and normal
code review still apply.

GitHub CLI operations must use `python tooling/github.py ...`. The wrapper always obtains the `noamtz` token from
the GitHub CLI keyring, regardless of which account happens to be globally active.
