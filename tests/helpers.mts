// Shared setup for tests that need Postgres. They run against TEST_DATABASE_URL, whose
// schema is wiped, so it must never point at a real Orion database.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a throwaway database (its name must contain "test")');
if (!new URL(url).pathname.includes('test')) {
  throw new Error('TEST_DATABASE_URL must name a database containing "test"; its contents are deleted');
}
process.env.DATABASE_URL = url;

/** Drops everything and re-applies all migrations, so each test file starts empty. */
export async function resetDatabase(): Promise<void> {
  const { sql } = await import('@/db');
  const { migrateOnStartup } = await import('@/db/migrate');
  await sql().unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrateOnStartup();
}

/** Empties Orion's tables between tests (much faster than re-migrating). */
export async function clearTables(): Promise<void> {
  const { sql } = await import('@/db');
  await sql().unsafe('truncate users, sessions, settings cascade');
}

export async function closeDatabase(): Promise<void> {
  const { sql } = await import('@/db');
  await sql().end();
}
