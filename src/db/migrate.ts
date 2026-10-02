import 'server-only';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, isDatabaseConfigured } from '.';

/** Applies pending Drizzle migrations from ./drizzle. Runs once at server start. */
export async function migrateOnStartup(): Promise<void> {
  if (!isDatabaseConfigured()) {
    console.warn('[orion] DATABASE_URL is not set; skipping migrations');
    return;
  }
  try {
    await migrate(db(), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
    console.log('[orion] database migrations are up to date');
  } catch (err) {
    // Without its schema Orion can only serve errors. Exit so the container restarts and
    // retries (e.g. when Postgres comes up after Orion) instead of running half-broken.
    console.error('[orion] database migrations failed:', (err as Error).message);
    process.exit(1);
  }
}
