<!-- Pono for Codex: paste into the project's AGENTS.md (or ~/.codex/AGENTS.md). -->

## Pono

This project is followed by Pono, reached through the `pono` MCP server.

- At the start of a session, call `find_project` with this folder's git remote, then
  `resume_project` and `dev_status`. Tell the person the preview address when it helps.
- Follow the skills `resume_project` returns (`get_skill`); this repository's own conventions come
  first.
- Before any commit, call `check_secrets` on the changed files and fix every finding.
- Never ask for a key in the conversation: ask for a variable by name with `request_variable`.
- You never merge to production, change the release mode, or roll back: you propose; a person
  decides, under the project's release rule.
