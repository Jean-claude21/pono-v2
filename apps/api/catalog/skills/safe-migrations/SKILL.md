---
name: safe-migrations
description: 'Write database migrations Pono accepts. Use whenever a change touches the schema.'
metadata:
  family: safety
  author: pono
---

- Additive only: create tables and columns, add indexes, add nullable columns or columns with a
  default. Never `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, a narrowing `ALTER ... TYPE`, or a
  `DELETE` without `WHERE`.
- To rename: add the new column, copy, switch the code, and remove the old one later, declared.
- A destruction you really want goes in `pono.yaml` under `release.declared_destructions`, alone in its
  proposal, with the reason.
- Every new table carries its owner's boundary and its access policy in the same migration.
