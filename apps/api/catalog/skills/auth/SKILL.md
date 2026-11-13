---
name: auth
description: 'Accounts, sessions and roles for an app. Use when the app needs people to sign in.'
metadata:
  family: opinion
  author: pono
---

- Use Better Auth with the project's Postgres: email and password plus magic links; sessions in
  HttpOnly, Secure, SameSite=Lax cookies.
- Roles live in the database and are checked on the server for every action.
- Every table of user data carries its owner and a row-level policy; tests prove one account never
  reads another's rows.
