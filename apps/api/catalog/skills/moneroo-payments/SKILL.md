---
name: moneroo-payments
description: 'Take mobile money and card payments in Africa with Moneroo (hosted checkout, signed webhook, payment verified again). Use when the app sells, takes a deposit or a subscription and the project uses Moneroo.'
metadata:
  family: opinion
  author: pono
---

Moneroo collects mobile money (Orange Money, MTN MoMo, Wave, Moov…) and cards through one hosted
checkout. Pono uses it for its own plans; these are the rules it follows.

1. **Keys.** `MONEROO_SECRET_KEY` and `MONEROO_WEBHOOK_SECRET` are development variables set by the
   person in the Pono console (sandbox keys on the dev server, never live ones). Read them from the
   environment; never write them in code, logs or messages.
2. **Start a payment on the server only.** `POST https://api.moneroo.io/v1/payments/initialize` with
   `Authorization: Bearer <secret key>`, `amount` (an integer in the currency's unit), `currency`,
   `description`, `return_url`, `customer` (`email`, `first_name`, `last_name`) and `metadata`
   (your order id). Redirect the buyer to `data.checkout_url`. Never handle a card or a phone PIN.
3. **The return page proves nothing.** Show « payment received, we are confirming », and wait for
   the webhook. An order is paid only after step 4.
4. **Webhook.** Read the raw body; check `X-Moneroo-Signature` = HMAC-SHA256 of the raw body with
   the webhook secret, in hex, compared in constant time. Refuse anything else with 400. On
   `payment.success`, call `GET https://api.moneroo.io/v1/payments/{id}/verify` and trust only
   that answer: status `success`, the expected currency, an amount at least the order's, and your
   order id in `metadata`.
5. **Once only.** Record the payment id in a table with a unique constraint before marking the
   order paid; a second delivery of the same event changes nothing.
6. **Amounts.** Prices live in the database as integers with their currency; the server computes
   the total, never the browser.

See `references/webhook.ts` for a handler that follows these rules.
