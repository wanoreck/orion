import 'server-only';
import { headers } from 'next/headers';

/**
 * Orion's public origin (e.g. https://orion.server.wanoreck.com), for URLs other sites send
 * people back to. ORION_PUBLIC_URL wins when set; otherwise it comes from the request as
 * forwarded by Traefik. Returns null if it isn't HTTPS, since WordPress only redirects back
 * to https:// URLs (contract §3).
 */
export async function publicOrigin(): Promise<string | null> {
  const configured = process.env.ORION_PUBLIC_URL;
  let origin: string;
  if (configured) {
    origin = new URL(configured).origin;
  } else {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
    if (!host) return null;
    origin = `${proto}://${host}`;
  }
  return origin.startsWith('https://') ? origin : null;
}
