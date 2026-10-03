import 'server-only';

/** A parsed ServiceFlow connection key (contract §1). `seed` is the Ed25519 private key. */
export type ConnectionKey = {
  /** REST root: `https://site/wp-json/` or `https://site/?rest_route=/`. */
  api: string;
  /** The site's home URL. */
  site: string;
  /** Connection UUID, sent as X-SF-Connection. */
  id: string;
  seed: Buffer;
};

export type ParseResult = { ok: true; key: ConnectionKey } | { ok: false; error: string };

const PREFIX = 'sfk1_';

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Validates and decodes a pasted key. Error messages describe what's wrong without
 * repeating any of the key, since they're shown in the browser.
 */
export function parseConnectionKey(raw: string): ParseResult {
  const text = raw.trim();
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (!text) return fail('Paste a connection key.');
  if (!text.startsWith(PREFIX)) {
    return fail(`That isn't a ServiceFlow connection key. Keys start with "${PREFIX}".`);
  }
  const body = text.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) {
    return fail('The key contains unexpected characters. Copy it again from ServiceFlow (Settings → Orion).');
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!json || typeof json !== 'object') throw new Error();
  } catch {
    return fail('The key is incomplete or damaged. Copy it again from ServiceFlow (Settings → Orion).');
  }
  if (json.v !== 1) return fail('This key is for a different version of ServiceFlow than Orion supports.');
  const api = httpUrl(json.api);
  const site = httpUrl(json.site);
  if (!api || !site) return fail('The key has no valid site address in it.');
  if (typeof json.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(json.id)) {
    return fail('The key has no valid connection ID in it.');
  }
  const seed = typeof json.key === 'string' ? Buffer.from(json.key, 'base64url') : Buffer.alloc(0);
  if (seed.length !== 32) return fail('The key has no valid signing key in it.');
  return { ok: true, key: { api, site, id: json.id, seed } };
}
