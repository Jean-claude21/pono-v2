import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import appCss from '@/styles/app.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: m.meta_title() },
      { name: 'description', content: m.meta_description() },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: () => (
    <Document>
      <Outlet />
    </Document>
  ),
});

function Document({ children }: Readonly<{ children: ReactNode }>) {
  // The console is a control room: dark (D-009).
  return (
    <html lang={getLocale()} data-theme="console">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
