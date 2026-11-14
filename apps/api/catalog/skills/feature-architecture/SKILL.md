---
name: feature-architecture
description: 'Organize the code by feature, the Pono way. Use when creating a module or moving code around.'
metadata:
  family: opinion
  author: pono
---

- One folder per feature under `src/features/<feature>`: its routes, its application functions, its
  domain and its ports. A feature never imports another feature's internals, only its `index.ts`.
- `domain/` holds pure rules: no provider name, no network, no database. `application` orchestrates;
  `infrastructure/` holds the adapters, one file per provider, behind a port.
- Every boundary validates its input with Zod; every visible text comes from the message catalog.
- Tests sit next to the behaviour they prove: a real database for data, fakes only for providers.
- If the repository already has its own conventions (its `CLAUDE.md`, `AGENTS.md`), they come first.
