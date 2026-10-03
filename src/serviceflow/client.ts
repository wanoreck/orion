import 'server-only';
import type { KeyObject } from 'node:crypto';
import type { ConnectionKey } from './key';
import { canonicalQuery, newNonce, privateKeyFromSeed, signatureHeaders, type Query } from './signing';

// The server-side ServiceFlow API client (contract §2, §4, §5). Never import this from
// client components: it holds the connection's private key.

/** The API version docs/API-CONTRACT.md describes; GET /connection reports the site's. */
export const CONTRACT_API_VERSION = '0.2.0';

/** Every error code in contract §4, plus Orion's own for failures before a JSON answer. */
export const API_ERROR_CODES = [
  'sf_api_connection_required',
  'sf_api_connection_unknown',
  'sf_api_connection_revoked',
  'sf_api_signature_expired',
  'sf_api_signature_invalid',
  'sf_api_bad_nonce',
  'sf_api_unsupported_query',
  'sf_api_bad_time',
  'sf_api_replayed',
  'sf_api_link_required',
  'sf_api_link_mismatch',
  'sf_api_forbidden',
  'sf_api_order_not_found',
] as const;

/**
 * What the caller should do about an error:
 * - connection: the key is wrong, deleted or revoked. Stop polling; an Admin must fix Settings.
 * - link: the account's WordPress link is missing or broken. Relink (D6).
 * - forbidden: the linked WordPress user lacks access.
 * - not_found: the thing asked for doesn't exist (or is trashed).
 * - request: Orion built a bad request. A bug on Orion's side, or an API version mismatch.
 * - unreachable: the site didn't answer, or answered with something that isn't the API.
 */
export type ApiErrorKind = 'connection' | 'link' | 'forbidden' | 'not_found' | 'request' | 'unreachable';

const KIND_BY_CODE: Record<string, ApiErrorKind> = {
  sf_api_connection_required: 'request',
  sf_api_connection_unknown: 'connection',
  sf_api_connection_revoked: 'connection',
  sf_api_signature_expired: 'request',
  sf_api_signature_invalid: 'connection',
  sf_api_bad_nonce: 'request',
  sf_api_unsupported_query: 'request',
  sf_api_bad_time: 'request',
  sf_api_replayed: 'request',
  sf_api_link_required: 'link',
  sf_api_link_mismatch: 'link',
  sf_api_forbidden: 'forbidden',
  sf_api_order_not_found: 'not_found',
  // WordPress core, for a wrong or deleted Application Password (§3 step 5, §4 last row).
  incorrect_password: 'link',
  invalid_username: 'link',
  invalid_email: 'link',
  rest_forbidden: 'forbidden',
  rest_no_route: 'request',
  orion_unreachable: 'unreachable',
  orion_bad_response: 'unreachable',
};

const MESSAGES: Record<string, string> = {
  sf_api_connection_required: "Orion's request was missing its signature.",
  sf_api_connection_unknown:
    "The ServiceFlow site doesn't recognize this connection. It may be for a different site, or it was deleted.",
  sf_api_connection_revoked: 'This connection was revoked in ServiceFlow (Settings → Orion).',
  sf_api_signature_expired: "Orion's clock and the ServiceFlow site's clock disagree by more than 5 minutes.",
  sf_api_signature_invalid:
    "The ServiceFlow site rejected Orion's signature. The key may be damaged, or not the one this site issued.",
  sf_api_bad_nonce: 'ServiceFlow rejected the request as malformed (nonce).',
  sf_api_unsupported_query: 'ServiceFlow rejected the request as malformed (query).',
  sf_api_bad_time: 'ServiceFlow rejected the request as malformed (time).',
  sf_api_replayed: 'ServiceFlow refused a repeated request.',
  sf_api_link_required: 'This action needs your Orion account to be linked to a WordPress user.',
  sf_api_link_mismatch: "Your WordPress link wasn't made through this connection. Link your account again.",
  sf_api_forbidden: "Your WordPress user doesn't have access to this.",
  sf_api_order_not_found: "That order doesn't exist, or it's in the trash.",
  incorrect_password: 'Your WordPress link no longer works (its Application Password was removed). Link again.',
  orion_unreachable: "Couldn't reach the ServiceFlow site.",
  orion_bad_response: "The ServiceFlow site's answer wasn't the ServiceFlow API.",
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly data?: Record<string, unknown>,
    /**
     * Technical specifics for Admins: the host Orion tried, the network or TLS error code, the
     * HTTP status, the site's own message. Never the key, signature or request headers.
     */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = KIND_BY_CODE[code] ?? (status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'request');
  }

  /** A message for people, preferring Orion's wording for known codes. */
  get explanation(): string {
    return MESSAGES[this.code] ?? this.message;
  }
}

// Plain-language hints for the network and TLS error codes Node reports.
const NETWORK_HINTS: Record<string, string> = {
  ENOTFOUND: "the host name doesn't resolve in DNS from Orion's server",
  EAI_AGAIN: "DNS lookup failed temporarily from Orion's server",
  ECONNREFUSED: 'the host refused the connection (nothing listening on that port)',
  ECONNRESET: 'the connection was reset',
  ETIMEDOUT: 'the connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
  UND_ERR_HEADERS_TIMEOUT: 'the site accepted the connection but sent no response in time',
  UND_ERR_SOCKET: 'the connection closed unexpectedly',
  EHOSTUNREACH: "the host is unreachable from Orion's server",
  ENETUNREACH: "the network is unreachable from Orion's server",
  CERT_HAS_EXPIRED: "the site's TLS certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "the site's TLS certificate is self-signed",
  SELF_SIGNED_CERT_IN_CHAIN: "the site's TLS certificate chain is self-signed",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the site's TLS certificate can't be verified (incomplete chain?)",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "the site's TLS certificate issuer isn't trusted",
  ERR_TLS_CERT_ALTNAME_INVALID: "the site's TLS certificate doesn't cover this host name",
  EPROTO: 'the TLS handshake failed (is the port really HTTPS?)',
  ERR_SSL_WRONG_VERSION_NUMBER: 'the TLS handshake failed (is the port really HTTPS?)',
};

/** "host:port" of a URL, without path or query. */
function hostOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
}

/** Digs the code and message out of fetch's error chain (TypeError → cause → AggregateError). */
export function describeNetworkFailure(err: unknown, url: string): string {
  const where = hostOf(url);
  if ((err as Error)?.name === 'TimeoutError') return `ETIMEDOUT: no answer from ${where} within the time limit`;
  let cause: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; depth < 5 && cause; depth++) {
    const c = cause as { code?: unknown; message?: unknown; errors?: unknown[]; cause?: unknown };
    const inner = Array.isArray(c.errors) ? (c.errors.find((e) => (e as { code?: unknown })?.code) as typeof c) : undefined;
    const code = typeof c.code === 'string' ? c.code : typeof inner?.code === 'string' ? inner.code : undefined;
    if (code) {
      const hint = NETWORK_HINTS[code];
      const message = typeof (inner ?? c).message === 'string' ? String((inner ?? c).message) : '';
      return `${code} connecting to ${where}: ${hint ?? message}${hint && message ? ` (${message})` : ''}`;
    }
    if (!c.cause && typeof c.message === 'string' && c.message) return `connecting to ${where}: ${c.message}`;
    cause = c.cause;
  }
  return `connecting to ${where}: ${(err as Error)?.message || 'unknown error'}`;
}

export type ApiResponse<T> = {
  data: T;
  status: number;
  /** X-SF-Server-Time: the next polling cursor (§5, §6). Never use Orion's own clock. */
  serverTime: number | null;
  headers: Headers;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  /** JSON-serialized for writes. */
  body?: unknown;
  /** WordPress Application Password for linked routes (§3). */
  basicAuth?: { username: string; password: string };
  timeoutMs?: number;
};

/** The URL for a route under the key's REST root, pretty (`/wp-json/`) or plain (`?rest_route=/`). */
export function requestUrl(apiRoot: string, route: string, query: Query = {}): string {
  const root = new URL(apiRoot);
  const qs = canonicalQuery(query);
  if (root.searchParams.has('rest_route')) {
    root.search = '';
    const restRoute = `rest_route=${encodeURIComponent(route).replace(/%2F/g, '/')}`;
    return `${root.toString()}?${restRoute}${qs ? `&${qs}` : ''}`;
  }
  const base = root.toString().replace(/\/+$/, '');
  return `${base}${route}${qs ? `?${qs}` : ''}`;
}

// Per connection, how far Orion's clock is behind the site's, learned from
// sf_api_signature_expired. Keeps signing working on a server with a drifting clock.
const clockOffsets = new Map<string, number>();
const privateKeys = new WeakMap<ConnectionKey, KeyObject>();

function privateKey(key: ConnectionKey): KeyObject {
  let k = privateKeys.get(key);
  if (!k) privateKeys.set(key, (k = privateKeyFromSeed(key.seed)));
  return k;
}

async function send<T>(key: ConnectionKey, route: string, options: RequestOptions): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const body = options.body === undefined ? '' : JSON.stringify(options.body);
  const timestamp = Math.floor(Date.now() / 1000) + (clockOffsets.get(key.id) ?? 0);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...signatureHeaders(key.id, privateKey(key), {
      method,
      route,
      query: options.query,
      timestamp,
      nonce: newNonce(),
      body,
    }),
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (options.basicAuth) {
    const { username, password } = options.basicAuth;
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  const url = requestUrl(key.api, route, options.query);
  const where = hostOf(url);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      // Never follow redirects: a signed request (and any Application Password) goes only to
      // the address in the key.
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (err) {
    const detail = describeNetworkFailure(err, url);
    throw new ApiError('orion_unreachable', 0, `Couldn't reach the ServiceFlow site: ${detail}.`, undefined, detail);
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    let target = 'an unspecified address';
    try {
      if (location) target = hostOf(new URL(location, url).toString());
    } catch {
      // Unparseable Location header: keep the generic wording.
    }
    const detail = `HTTP ${res.status} redirect from ${where} to ${target}. Check the site address in ServiceFlow's settings, then create a new key.`;
    throw new ApiError('orion_bad_response', res.status, `The site redirected Orion elsewhere: ${detail}`, undefined, detail);
  }

  const serverTimeHeader = Number(res.headers.get('X-SF-Server-Time'));
  const serverTime = Number.isFinite(serverTimeHeader) && serverTimeHeader > 0 ? serverTimeHeader : null;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const type = res.headers.get('content-type') ?? 'no content type';
    const detail = `HTTP ${res.status} from ${where}, ${type}, not JSON. Is the key's REST address right, and is the ServiceFlow plugin active?`;
    throw new ApiError('orion_bad_response', res.status, `The site's answer wasn't JSON: ${detail}`, undefined, detail);
  }

  if (!res.ok) {
    const err = json as { code?: unknown; message?: unknown; data?: unknown } | null;
    const code = typeof err?.code === 'string' ? err.code : `http_${res.status}`;
    const message = typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`;
    const data = err?.data && typeof err.data === 'object' ? (err.data as Record<string, unknown>) : undefined;
    // The site's own message is safe to show Admins; it never contains Orion's key.
    const detail = `HTTP ${res.status} from ${where}: ${code}: ${message.slice(0, 300)}`;
    throw new ApiError(code, res.status, message, data, detail);
  }
  return { data: json as T, status: res.status, serverTime, headers: res.headers };
}

/**
 * Makes a signed request. Retries once when the only problem is recoverable on Orion's
 * side: clock skew (re-sign using the site's clock) or a nonce collision on a write.
 */
export async function apiRequest<T>(
  key: ConnectionKey,
  route: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  try {
    return await send<T>(key, route, options);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === 'sf_api_signature_expired') {
      const serverTime = Number(err.data?.server_time);
      if (!Number.isFinite(serverTime)) throw err;
      clockOffsets.set(key.id, serverTime - Math.floor(Date.now() / 1000));
      return send<T>(key, route, options);
    }
    if (err.code === 'sf_api_replayed') return send<T>(key, route, options);
    throw err;
  }
}
