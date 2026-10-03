import 'server-only';
import { createHash, createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';

// Request signing, exactly as in docs/API-CONTRACT.md §2. If ServiceFlow rejects a
// signature, compare canonicalString() byte for byte with tools/sf-api-request.php there.

export type QueryValue = string | number | boolean;
export type Query = Record<string, QueryValue | undefined>;

/** RFC 3986 percent-encoding: encodeURIComponent plus ! ' ( ) * (contract §2). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Drops `rest_route` and unset values, sorts by key in byte order, and encodes keys and
 * values. Also used as the real request's query string, so both always agree.
 */
export function canonicalQuery(query: Query = {}): string {
  return Object.entries(query)
    .filter((entry): entry is [string, QueryValue] => entry[0] !== 'rest_route' && entry[1] !== undefined)
    .map(([key, value]) => [Buffer.from(key), rfc3986(key), rfc3986(String(value))] as const)
    // Byte order, not locale order: compare the UTF-8 bytes of the raw keys.
    .sort((a, b) => Buffer.compare(a[0], b[0]))
    .map(([, key, value]) => `${key}=${value}`)
    .join('&');
}

export function sha256Hex(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export type SignedParts = {
  method: string;
  /** REST route, e.g. /serviceflow/v1/orders/42 */
  route: string;
  query?: Query;
  timestamp: number;
  nonce: string;
  /** Raw request body exactly as sent; '' when there's none. */
  body?: string;
};

/** Seven lines joined with \n, no trailing newline. */
export function canonicalString(parts: SignedParts): string {
  return [
    'SFv1',
    parts.method.toUpperCase(),
    parts.route,
    canonicalQuery(parts.query),
    String(parts.timestamp),
    parts.nonce,
    sha256Hex(parts.body ?? ''),
  ].join('\n');
}

// PKCS#8 DER wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function privateKeyFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

/** 32 chars of A–Z a–z 0–9 _ -, within the contract's 16–64. */
export function newNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** The four X-SF-* headers for a request. */
export function signatureHeaders(
  connectionId: string,
  privateKey: KeyObject,
  parts: SignedParts,
): Record<string, string> {
  const signature = sign(null, Buffer.from(canonicalString(parts), 'utf8'), privateKey);
  return {
    'X-SF-Connection': connectionId,
    'X-SF-Timestamp': String(parts.timestamp),
    'X-SF-Nonce': parts.nonce,
    'X-SF-Signature': signature.toString('base64'),
  };
}
