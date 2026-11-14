---
name: payments
description: 'Take payments safely. Use when the app charges money (deposit, cart, subscription).'
metadata:
  family: opinion
  author: pono
---

- Use the provider's hosted checkout; never handle card numbers.
- An order is paid only when the provider's signed webhook says so: verify the signature, make the
  handler idempotent by event id.
- Amounts are integers in the smallest unit, with their currency.
- Test keys only on the development server.
