import type { Notifier } from '../../features/operations/index.js';
import { fetchJson, type Fetch } from '../../platform/http.js';

/** Alerts by email through Resend (D-018): Pono's own key, never a person's. */
export function resendNotifier(input: { apiKey: string; from: string; fetch: Fetch }): Notifier {
  return {
    id: 'resend',
    async send(message) {
      await fetchJson(input.fetch, {
        provider: 'resend',
        url: 'https://api.resend.com/emails',
        method: 'POST',
        headers: { authorization: `Bearer ${input.apiKey}` },
        body: { from: input.from, to: message.to, subject: message.subject, text: message.text },
      });
    },
  };
}
