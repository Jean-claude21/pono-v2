---
description: Push the work to dev through Pono, after its secrets check
---

Find this project with `find_project`. If the work is on the Pono server, call `push_changes` with
a short message; if Pono refuses for a secret, show the file and line and fix it, never repeat the
value. If the work is on this machine, run the project's checks, call `check_secrets` on the
changed files, commit and push to `dev`, then call `pull_changes` so the preview follows.
Production is reached only by a proposal, under the project's release rule: never merge yourself.
