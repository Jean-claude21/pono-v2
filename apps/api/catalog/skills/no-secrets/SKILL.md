---
name: no-secrets
description: 'Keep keys out of the code. Use before writing any configuration, client or integration.'
metadata:
  family: safety
  author: pono
---

- Read every key from an environment variable, document it in `.env.example` with an empty value,
  and never commit a `.env` file.
- Never paste a key in the chat, a commit, a log or an error. If the person gives you one in the
  conversation, tell them to revoke it and to set it in Pono instead.
- On a project server you only have test keys. Production keys live at the host.
- Pono scans every proposal before release: a key found blocks the release, in every mode.
