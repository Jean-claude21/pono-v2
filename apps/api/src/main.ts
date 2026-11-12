import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './platform/config.js';
import { createPool, ping } from './platform/db.js';

const config = loadConfig();
const pool = createPool(config.PONO_DATABASE_URL);
const app = createApp({ databaseUp: () => ping(pool) });

serve({ fetch: app.fetch, port: config.PONO_API_PORT }, (info) => {
  console.log(`Pono API on http://localhost:${info.port}`);
});
