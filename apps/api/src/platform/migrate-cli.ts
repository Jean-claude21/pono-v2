import { createPool } from './db.js';
import { migrate } from './migrate.js';

const url = process.env.PONO_DATABASE_OWNER_URL;
if (!url) {
  console.error('PONO_DATABASE_OWNER_URL is not set: migrations run as the owner role.');
  process.exit(1);
}
const pool = createPool(url);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply.');
} finally {
  await pool.end();
}
