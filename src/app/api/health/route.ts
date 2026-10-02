import { isDatabaseConfigured, sql } from '@/db';

export const dynamic = 'force-dynamic';

// Health check for Coolify and the Docker HEALTHCHECK. Reports only Orion's own state;
// the ServiceFlow connection is shown in the app instead, since "no connection" is a normal state (D4).
export async function GET() {
  let database: 'ok' | 'not_configured' | 'error' = 'not_configured';
  if (isDatabaseConfigured()) {
    try {
      await sql()`select 1`;
      database = 'ok';
    } catch (err) {
      database = 'error';
      console.error('[orion] health check: database unreachable:', (err as Error).message);
    }
  }
  const ok = database === 'ok';
  return Response.json(
    { status: ok ? 'ok' : 'error', database },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
