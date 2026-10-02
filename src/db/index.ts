import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

// One pool per server process. Kept on globalThis so dev hot reloads don't open new pools.
const globalForDb = globalThis as unknown as { orionSql?: postgres.Sql; orionDb?: Database };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The raw postgres.js client. Created on first use so builds don't need a database. */
export function sql(): postgres.Sql {
  if (!globalForDb.orionSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.orionSql = postgres(url, { max: 10, connect_timeout: 5 });
  }
  return globalForDb.orionSql;
}

export function db(): Database {
  globalForDb.orionDb ??= drizzle(sql(), { schema });
  return globalForDb.orionDb;
}
