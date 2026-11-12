import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Whether the database answers. */
export async function ping(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `work` in one transaction scoped to an organization: every table of an organization only
 * shows that organization's rows (row-level security, principle 4).
 */
export async function withOrganization<T>(
  pool: Pool,
  organizationId: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('pono.organization_id', $1, true)", [organizationId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `work` in one transaction without any organization: organization tables show nothing. */
export async function withoutOrganization<T>(
  pool: Pool,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
