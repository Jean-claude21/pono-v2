---
name: emails
description: 'Send transactional emails. Use for confirmations, reminders, resets and receipts.'
metadata:
  family: opinion
  author: pono
---

- Send through the provider configured for the project, from a verified domain; the key comes from
  the environment.
- Templates in code, in the person's languages, with a plain-text version.
- Reminders run as scheduled jobs; each send is recorded to avoid duplicates.
