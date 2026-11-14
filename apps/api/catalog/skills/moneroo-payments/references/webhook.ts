// A Moneroo webhook handler (Hono + node-postgres), as Pono's own: signed, verified again, once only.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { Pool } from 'pg';

const API = 'https://api.moneroo.io/v1';

export function signed(raw: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const given = Buffer.from(header.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function monerooWebhook(app: Hono, db: Pool) {
  app.post('/payments/webhook', async (c) => {
    const raw = await c.req.text();
    if (!signed(raw, c.req.header('x-moneroo-signature'), process.env.MONEROO_WEBHOOK_SECRET!))
      return c.json({ error: 'bad signature' }, 400);
    const event = JSON.parse(raw) as { event?: string; data?: { id?: string } };
    if (event.event !== 'payment.success' || !event.data?.id) return c.body(null, 204);

    const res = await fetch(`${API}/payments/${encodeURIComponent(event.data.id)}/verify`, {
      headers: {
        authorization: `Bearer ${process.env.MONEROO_SECRET_KEY}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) return c.json({ error: 'verify failed' }, 502); // Moneroo retries
    const p = (await res.json()).data as {
      id: string;
      status: string;
      amount: number;
      currency: string | { code: string };
      metadata?: { order?: string };
    };
    const currency = typeof p.currency === 'string' ? p.currency : p.currency.code;
    const order = p.metadata?.order;
    if (p.status !== 'success' || !order) return c.body(null, 204);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<{ total: number; currency: string }>(
        'SELECT total, currency FROM orders WHERE id = $1 FOR UPDATE',
        [order],
      );
      const o = due.rows[0];
      if (o && o.currency === currency && p.amount >= o.total) {
        // payments.provider_id is UNIQUE: a second delivery inserts nothing.
        const inserted = await client.query(
          'INSERT INTO payments (provider_id, order_id, amount, currency) VALUES ($1, $2, $3, $4) ON CONFLICT (provider_id) DO NOTHING',
          [p.id, order, p.amount, currency],
        );
        if (inserted.rowCount)
          await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [order]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return c.body(null, 204);
  });
}
