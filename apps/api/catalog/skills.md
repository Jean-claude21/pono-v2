<!-- The skills Pono serves to agents (D-006 of the first Pono: served, never frozen in a plugin).
     One section per skill: `## <name>`, its description on the next line in italics, then its body.
     Read by src/features/catalog. -->

## pono-basics

_How to work on a project hosted by Pono. Use at the start of every session on a Pono project._

- The repository is the person's own, on their code host. Work on the `dev` branch; never push to
  the production branch: Pono refuses it mechanically, and a release goes through a proposal.
- The development database is a branch of the production one; production keys are never on this
  server. If a key is missing, ask the person through Pono (`request_secret`), never in the chat.
- Read `pono.yaml` at the root: it names the project, its hosting, its database and its declared
  intentions (a destructive migration must be declared there).
- Keep the work in small commits with clear messages; open a proposal when the person asks to ship.
- Before proposing, run the project's checks and tests.

## safe-migrations

_Write database migrations Pono accepts. Use whenever a change touches the schema._

- Additive only: create tables and columns, add indexes, add nullable columns or columns with a
  default. Never `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, a narrowing `ALTER ... TYPE`, or a
  `DELETE` without `WHERE`.
- To rename: add the new column, copy, switch the code, and remove the old one later, declared.
- A destruction you really want goes in `pono.yaml` under `declared_destructions`, alone in its
  proposal, with the reason.
- Every new table carries its owner's boundary and its access policy in the same migration.

## no-secrets

_Keep keys out of the code. Use before writing any configuration, client or integration._

- Read every key from an environment variable, document it in `.env.example` with an empty value,
  and never commit a `.env` file.
- Never paste a key in the chat, a commit, a log or an error. If the person gives you one in the
  conversation, tell them to revoke it and to set it in Pono instead.
- On a project server you only have test keys. Production keys live at the host.
- Pono scans every proposal before release: a key found blocks the release, in every mode.

## auth

_Accounts, sessions and roles for an app. Use when the app needs people to sign in._

- Use Better Auth with the project's Postgres: email and password plus magic links; sessions in
  HttpOnly, Secure, SameSite=Lax cookies.
- Roles live in the database and are checked on the server for every action.
- Every table of user data carries its owner and a row-level policy; tests prove one account never
  reads another's rows.

## payments

_Take payments safely. Use when the app charges money (deposit, cart, subscription)._

- Use the provider's hosted checkout; never handle card numbers.
- An order is paid only when the provider's signed webhook says so: verify the signature, make the
  handler idempotent by event id.
- Amounts are integers in the smallest unit, with their currency.
- Test keys only on the development server.

## emails

_Send transactional emails. Use for confirmations, reminders, resets and receipts._

- Send through the provider configured for the project, from a verified domain; the key comes from
  the environment.
- Templates in code, in the person's languages, with a plain-text version.
- Reminders run as scheduled jobs; each send is recorded to avoid duplicates.

## seo

_Make public pages findable and fast. Use for showcase sites and public pages._

- One title and description per page, Open Graph tags, a canonical URL.
- `sitemap.xml` and `robots.txt` generated from the routes.
- Pages rendered on the server, images sized and lazy, no layout shift.

## exports

_Export data as CSV or PDF. Use when people need to take their data out._

- CSV in UTF-8 with a header row, dates in ISO 8601.
- Large exports run as background jobs and are delivered by a link that expires.
- An export only contains what the person may read, and is journaled.
