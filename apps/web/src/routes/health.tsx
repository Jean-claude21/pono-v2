import { createFileRoute } from '@tanstack/react-router';

// Answered to machines (the host's probe), never shown to a person.
export const Route = createFileRoute('/health')({
  server: { handlers: { GET: () => Response.json({ status: 'ok' }) } },
});
