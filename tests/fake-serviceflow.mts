// A stand-in ServiceFlow site for tests. It checks signatures the way the plugin does
// (contract §2), but from the receiving side and with its own code: it rebuilds the
// canonical string from the raw URL it was sent, so an encoding mismatch in Orion's client
// fails here instead of passing because both sides share a bug.
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeSite = {
  url: string;
  /** A valid sfk1_ key for this site. */
  key: string;
  connectionId: string;
  /** Seconds added to the site's clock (to simulate skew). */
  clockOffset: number;
  /** When set, every request fails with this error code. */
  failWith: { status: number; code: string } | null;
  /** Requests seen: method, route, query (decoded), and whether the signature was valid. */
  requests: { method: string; route: string; query: Record<string, string>; valid: boolean }[];
  /** Use the plain-permalink REST root (?rest_route=/) in the key. */
  plainPermalinks: boolean;
  makeKey(overrides?: Record<string, unknown>): string;
  close(): Promise<void>;
};

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** RFC 3986, written independently of the client: everything but unreserved, as %XX of UTF-8. */
function encode(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const c = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-._~]/.test(c) ? c : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export const COUNTS = [
  { key: 'active', label: 'Active', count: 7 },
  { key: 'draft', label: 'Draft', count: 1 },
  { key: 'placed', label: 'Placed', count: 2 },
  { key: 'progress', label: 'In Progress', count: 3 },
  { key: 'delivery', label: 'Delivery', count: 1 },
  { key: 'on_hold', label: 'On Hold', count: 0 },
  { key: 'pending_approval', label: 'Pending Approval', count: 0 },
  { key: 'completed', label: 'Completed', count: 12 },
  { key: 'cancelled', label: 'Cancelled', count: 4 },
  { key: 'all', label: 'All', count: 26 },
];

export async function startFakeServiceFlow(): Promise<FakeSite> {
  const seed = randomBytes(32);
  const publicKey = createPublicKey(createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' }));
  const connectionId = randomUUID();

  const site: FakeSite = {
    url: '',
    key: '',
    connectionId,
    clockOffset: 0,
    failWith: null,
    requests: [],
    plainPermalinks: false,
    makeKey(overrides = {}) {
      const api = site.plainPermalinks ? `${site.url}/?rest_route=/` : `${site.url}/wp-json/`;
      const json = { v: 1, api, site: site.url, id: connectionId, key: seed.toString('base64url'), ...overrides };
      return `sfk1_${Buffer.from(JSON.stringify(json)).toString('base64url')}`;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const now = Math.floor(Date.now() / 1000) + site.clockOffset;
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-SF-Server-Time': String(now), ...headers });
    res.end(JSON.stringify(body));
  }

  function error(res: ServerResponse, status: number, code: string, data: Record<string, unknown> = {}) {
    send(res, status, { code, message: `fake: ${code}`, data: { status, ...data } });
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');

    // Parse the query from the raw URL, as PHP would: split on & and =, then decode.
    const rawUrl = req.url ?? '/';
    const rawQuery = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '';
    const query: Record<string, string> = {};
    for (const pair of rawQuery.split('&').filter(Boolean)) {
      const [k, v = ''] = pair.split('=');
      query[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    const path = rawUrl.split('?')[0];
    const route = query.rest_route ?? (path.startsWith('/wp-json') ? path.slice('/wp-json'.length) : path);

    if (route === '/redirect-me') {
      res.writeHead(301, { Location: 'https://elsewhere.example/' });
      return res.end();
    }
    if (route === '/not-json') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>a WordPress page</html>');
    }

    const h = (name: string) => req.headers[name.toLowerCase()] as string | undefined;
    const record = { method: req.method ?? '', route, query: { ...query }, valid: false };
    site.requests.push(record);

    if (!h('X-SF-Connection') || !h('X-SF-Timestamp') || !h('X-SF-Nonce') || !h('X-SF-Signature')) {
      return error(res, 401, 'sf_api_connection_required');
    }
    if (h('X-SF-Connection') !== connectionId) return error(res, 401, 'sf_api_connection_unknown');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(h('X-SF-Nonce')!)) return error(res, 400, 'sf_api_bad_nonce');

    const canonicalQuery = Object.keys(query)
      .filter((k) => k !== 'rest_route')
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map((k) => `${encode(k)}=${encode(query[k])}`)
      .join('&');
    const canonical = [
      'SFv1',
      req.method,
      route,
      canonicalQuery,
      h('X-SF-Timestamp'),
      h('X-SF-Nonce'),
      createHash('sha256').update(body).digest('hex'),
    ].join('\n');
    if (!verify(null, Buffer.from(canonical), publicKey, Buffer.from(h('X-SF-Signature')!, 'base64'))) {
      return error(res, 401, 'sf_api_signature_invalid');
    }
    record.valid = true;

    const serverNow = Math.floor(Date.now() / 1000) + site.clockOffset;
    if (Math.abs(Number(h('X-SF-Timestamp')) - serverNow) > 300) {
      return error(res, 401, 'sf_api_signature_expired', { server_time: serverNow });
    }
    if (site.failWith) return error(res, site.failWith.status, site.failWith.code);

    switch (route) {
      case '/serviceflow/v1/connection':
        return send(res, 200, {
          connection: { id: connectionId, label: 'Orion (test)', created_at: '2026-10-01T09:00:00-05:00' },
          site: {
            name: 'Fake ServiceFlow', url: site.url, timezone: 'America/Chicago', currency: 'USD',
            stripe_mode: 'test', plugin_version: '1.5.0', api_version: '0.2.0',
          },
          linking: { available: false, authorize_url: `${site.url}/wp-admin/authorize-application.php`, app_id: 'x', app_name: 'Orion' },
        });
      case '/serviceflow/v1/orders/counts':
        return send(res, 200, COUNTS);
      case '/serviceflow/v1/orders':
        return send(res, 200, [], { 'X-WP-Total': '42', 'X-WP-TotalPages': '3' });
      default:
        return error(res, 404, 'rest_no_route');
    }
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  site.key = site.makeKey();
  return site;
}
