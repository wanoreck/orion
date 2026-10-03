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
    console.error('[orion] database migrations failed:', redact(String((err as Error)?.message ?? err)));
    for (const line of describeCauses(err)) console.error(`[orion]   ${line}`);
    console.error(`[orion]   database: ${databaseTarget()}`);
    process.exit(1);
  }
}

/**
 * Drizzle wraps driver errors as "Failed query: …"; the reason (refused connection, bad
 * credentials, missing permission) is in error.cause. Lists each cause's code and message.
 */
function describeCauses(err: unknown): string[] {
  const lines: string[] = [];
  let cause = (err as { cause?: unknown } | null)?.cause;
  for (let depth = 0; cause != null && depth < 5; depth++) {
    const { code, message, errors } = cause as {
      code?: unknown;
      message?: unknown;
      errors?: unknown;
    };
    // Node reports dual-stack connection failures as an AggregateError with an empty message.
    let text = typeof message === 'string' && message ? message : '';
    if (!text && Array.isArray(errors)) {
      text = errors.map((e) => (e as Error)?.message).filter(Boolean).join('; ');
    }
    lines.push(`cause: ${code ? `[${String(code)}] ` : ''}${redact(text || String(cause))}`);
    cause = (cause as { cause?: unknown }).cause;
  }
  if (lines.length === 0) lines.push('cause: (none reported)');
  return lines;
}

/** Host and port from DATABASE_URL. Never the user, password or the full URL. */
function databaseTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return `host ${url.hostname || '(none)'}, port ${url.port || '5432'}`;
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
}

/** Belt and braces: drivers shouldn't echo the password, but never let one reach the log. */
function redact(text: string): string {
  let password = '';
  try {
    password = decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').password);
  } catch {
    // Unparseable URL: nothing to redact.
  }
  return password ? text.split(password).join('***') : text;
}
