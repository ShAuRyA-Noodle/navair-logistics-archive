import { Pool, type PoolClient } from 'pg';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
const globalDb = globalThis as unknown as { navairPool?: Pool };
let activePool = globalDb.navairPool;
function requirePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required. Run the local setup first.');
  if (!activePool) {
    activePool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
    if (process.env.NODE_ENV !== 'production') globalDb.navairPool = activePool;
  }
  return activePool;
}
// Next.js imports route modules while building; database configuration is needed only on use.
export const pool = new Proxy({} as Pool, {
  get(_target, property) {
    const db = requirePool();
    const value = Reflect.get(db, property, db);
    return typeof value === 'function' ? value.bind(db) : value;
  },
});
export async function withActor<T>(actorId: string | null, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.user_id', $1, true)", [actorId ?? '']);
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
