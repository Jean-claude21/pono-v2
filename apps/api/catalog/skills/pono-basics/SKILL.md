---
name: pono-basics
description: 'How to work on a project hosted by Pono. Use at the start of every session on a Pono project.'
metadata:
  family: safety
  author: pono
---

- The repository is the person's own, on their code host. Work on the `dev` branch; never push to
  the production branch: Pono refuses it mechanically, and a release goes through a proposal.
- The development database is a branch of the production one; production keys are never on this
  server. If a key is missing, ask for it by name with `request_variable`, never in the chat: the person
  types the value in the console.
- Read `pono.yaml` at the root: it names the project, its hosting, its database and its declared
  intentions (a destructive migration must be declared there).
- Keep the work in small commits with clear messages; open a proposal when the person asks to ship.
- Before each commit, pass the files to `check_secrets` and fix every finding.
- Before proposing, run the project's checks and tests.
- Coding through Pono's tools, with no machine of your own: read `references/workbench.md`.
