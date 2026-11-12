import { createFileRoute } from '@tanstack/react-router';
import { Shell } from '@/features/shell/Shell';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/')({ component: Workshop });

function Workshop() {
  return (
    <Shell>
      <div className="topline">
        <h1>{m.projects_title()}</h1>
      </div>
      <div className="notice mt-lg">
        <strong>{m.projects_empty_title()}</strong> {m.projects_empty_body()}
      </div>
    </Shell>
  );
}
