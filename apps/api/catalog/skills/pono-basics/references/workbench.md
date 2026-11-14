# Coding on a Pono server, from any chat

Read this when you code through Pono's MCP tools rather than on the person's machine.

1. `resume_project`, then `start_dev`: the repository is on the project's server, on `dev`, and the
   answer gives the preview address. The project's active skills are installed there too.
2. Find your way: `project_map` first in a project you do not know, then `search_code` and
   `read_file` by ranges. Read a file before you change it.
3. Change: `edit_file` with `old_text` exactly as read (add surrounding lines when it is not unique),
   or `apply_patch` to change several files at once. `write_file` only for a new file or a full
   rewrite. An edit that breaks a file's syntax is refused; `undo_edit` puts a file back.
4. Look: after each change, `devServer` lists the dev server's errors. Fix them before going on.
   Give the preview address to the person after a visible change.
5. Check: `run_command` for the tests, the linter or a build (bounded in time; `background` for
   long ones, read with `command_output`).
6. Save: `show_changes`, then `push_changes` with a clear message. It goes to `dev` only, after the
   secrets check. When the person wants it live, `propose_release`: a person decides.

Never print a key, never ask for one in the chat: name it with `request_variable`.
