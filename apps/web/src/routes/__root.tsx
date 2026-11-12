import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import appCss from '@/styles/app.css?url';

/**
 * Pono's own visits, counted by Umami when its site is configured at build time (D-017). Nothing is
 * sent from the operator's pages, and no personal data: Umami keeps no cookie.
 */
const UMAMI_SITE = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
const UMAMI_SCRIPT =
  (import.meta.env.VITE_UMAMI_SCRIPT_URL as string | undefined) ??
  'https://cloud.umami.is/script.js';
const BEFORE_SEND =
  'window.ponoBeforeSend=function(t,p){return location.pathname.indexOf("/admin")===0?null:p}';

export const Route = createRootRoute({
  head: () => ({
    scripts: UMAMI_SITE
      ? [
          { children: BEFORE_SEND },
          {
            src: UMAMI_SCRIPT,
            defer: true,
            'data-website-id': UMAMI_SITE,
            'data-before-send': 'ponoBeforeSend',
          },
        ]
      : [],
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
