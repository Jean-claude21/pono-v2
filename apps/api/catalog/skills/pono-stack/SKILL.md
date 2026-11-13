---
name: pono-stack
description: "Build on Pono's base: Hono, TanStack Start, Postgres on Neon. Use on a project launched from a template."
metadata:
  family: opinion
  author: pono
---

- API: Hono on Node 22, TypeScript strict, SQL written by hand with `pg`, versioned SQL migrations,
  row-level security on every table that holds a person's data.
- Console: TanStack Start, the project's design tokens, Paraglide for every visible text.
- Database: Neon, one branch per environment; the development branch never holds production keys.
- Analytics: Umami. On a Pono server the tag is in `PONO_ANALYTICS_SCRIPT`: add it once to the root
  layout; the site is already named in `pono.yaml`. Never track an admin page or a person's data.
