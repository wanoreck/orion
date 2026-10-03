import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import { startFakeServiceFlow, COUNTS, type FakeSite } from '../fake-serviceflow.mts';

const signing = await import('@/serviceflow/signing');
const { parseConnectionKey } = await import('@/serviceflow/key');
const { ApiError, API_ERROR_CODES, apiRequest, describeNetworkFailure, requestUrl } = await import('@/serviceflow/client');
const api = await import('@/serviceflow/api');
const secrets = await import('@/crypto/secrets');

function parse(raw: string) {
  const result = parseConnectionKey(raw);
  assert.ok(result.ok, !result.ok ? result.error : '');
  return result.key;
}

describe('canonical string (contract §2)', () => {
  test("reproduces the contract's worked example byte for byte", () => {
    // Copied verbatim from docs/API-CONTRACT.md §2.
    const expected = [
      'SFv1',
      'GET',
      '/serviceflow/v1/orders',
      'a=1&search=it%27s%20%28a%29%2Ab%21',
      '100',
      'n',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n');
    const actual = signing.canonicalString({
      method: 'get',
      route: '/serviceflow/v1/orders',
      // Out of order, and with rest_route, which must be dropped.
      query: { search: "it's (a)*b!", rest_route: '/serviceflow/v1/orders', a: 1 },
      timestamp: 100,
      nonce: 'n',
    });
    assert.deepEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'));
    assert.ok(!actual.endsWith('\n'), 'no trailing newline');
  });

  test('RFC 3986 encodes ! \' ( ) * and leaves unreserved characters alone', () => {
    assert.equal(signing.rfc3986("!'()*"), '%21%27%28%29%2A');
    assert.equal(signing.rfc3986('a-b_c.d~e'), 'a-b_c.d~e');
    assert.equal(signing.rfc3986('a b+c/d?e&f=g'), 'a%20b%2Bc%2Fd%3Fe%26f%3Dg');
    assert.equal(signing.rfc3986('café ☕'), 'caf%C3%A9%20%E2%98%95');
  });

  test('sorts keys in byte order, drops unset values, and is empty with no query', () => {
    assert.equal(signing.canonicalQuery({ b: 1, B: 2, a: 'x', a_b: 3, unset: undefined }), 'B=2&a=x&a_b=3&b=1');
    assert.equal(signing.canonicalQuery({}), '');
    assert.equal(signing.canonicalQuery({ rest_route: '/x' }), '');
  });

  test('hashes the raw body', () => {
    const body = '{"status":"progress"}';
    const line = signing.canonicalString({ method: 'POST', route: '/r', timestamp: 1, nonce: 'n', body }).split('\n')[6];
    assert.equal(line, signing.sha256Hex(body));
    assert.notEqual(line, signing.sha256Hex(''));
  });
});

describe('Ed25519 signing', () => {
  test('turns a raw seed into the right key (RFC 8032 test vector 1)', () => {
    const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
    const key = signing.privateKeyFromSeed(seed);
    const jwk = createPublicKey(key).export({ format: 'jwk' });
    assert.equal(Buffer.from(jwk.x!, 'base64url').toString('hex'), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  });

  test('signature headers verify against the canonical string', () => {
    const seed = Buffer.alloc(32, 7);
    const key = signing.privateKeyFromSeed(seed);
    const parts = { method: 'GET', route: '/serviceflow/v1/connection', timestamp: 1_700_000_000, nonce: signing.newNonce() };
    const headers = signing.signatureHeaders('conn-id', key, parts);
    assert.equal(headers['X-SF-Connection'], 'conn-id');
    assert.equal(headers['X-SF-Timestamp'], '1700000000');
    assert.match(headers['X-SF-Nonce'], /^[A-Za-z0-9_-]{16,64}$/);
    assert.match(headers['X-SF-Signature'], /^[A-Za-z0-9+/]+=*$/, 'standard base64');
    const signature = Buffer.from(headers['X-SF-Signature'], 'base64');
    assert.ok(verify(null, Buffer.from(signing.canonicalString(parts)), createPublicKey(key), signature));
  });

  test('nonces are fresh', () => {
    assert.notEqual(signing.newNonce(), signing.newNonce());
  });
});

describe('connection keys', () => {
  const seed = Buffer.alloc(32, 9).toString('base64url');
  const make = (json: unknown) => `sfk1_${Buffer.from(JSON.stringify(json)).toString('base64url')}`;
  const good = { v: 1, api: 'https://site.example/wp-json/', site: 'https://site.example', id: 'abc-123', key: seed };

  test('parses a valid key, ignoring surrounding whitespace', () => {
    const key = parse(`  ${make(good)}\n`);
    assert.equal(key.api, good.api);
    assert.equal(key.id, 'abc-123');
    assert.equal(key.seed.length, 32);
  });

  test('explains what is wrong without echoing the key', () => {
    const cases: [string, RegExp][] = [
      ['', /Paste/],
      ['sfk2_abc', /start with "sfk1_"/],
      ['sfk1_abc def', /unexpected characters/],
      ['sfk1_bm90IGpzb24', /incomplete or damaged/],
      [make({ ...good, v: 2 }), /different version/],
      [make({ ...good, api: 'ftp://x' }), /site address/],
      [make({ ...good, id: '' }), /connection ID/],
      [make({ ...good, key: 'c2hvcnQ' }), /signing key/],
    ];
    for (const [raw, message] of cases) {
      const result = parseConnectionKey(raw);
      assert.equal(result.ok, false, raw);
      const error = !result.ok ? result.error : '';
      assert.match(error, message);
      assert.ok(!error.includes(seed), 'no key material in the message');
    }
  });

  test('builds URLs for pretty and plain-permalink REST roots', () => {
    assert.equal(
      requestUrl('https://s.example/wp-json/', '/serviceflow/v1/orders', { search: 'a b', page: 2 }),
      'https://s.example/wp-json/serviceflow/v1/orders?page=2&search=a%20b',
    );
    assert.equal(
      requestUrl('https://s.example/?rest_route=/', '/serviceflow/v1/orders', { page: 2 }),
      'https://s.example/?rest_route=/serviceflow/v1/orders&page=2',
    );
    assert.equal(requestUrl('https://s.example/blog/wp-json', '/serviceflow/v1/connection'), 'https://s.example/blog/wp-json/serviceflow/v1/connection');
  });
});

describe('secrets at rest', () => {
  const original = process.env.ORION_ENCRYPTION_KEY;
  before(() => {
    process.env.ORION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  });
  after(() => {
    process.env.ORION_ENCRYPTION_KEY = original;
  });

  test('round-trips, and never stores the plaintext', () => {
    const stored = secrets.encryptSecret('sfk1_secret-value', 'purpose-a');
    assert.match(stored, /^v1\./);
    assert.ok(!stored.includes('secret-value'));
    assert.notEqual(stored, secrets.encryptSecret('sfk1_secret-value', 'purpose-a'), 'fresh IV each time');
    assert.equal(secrets.decryptSecret(stored, 'purpose-a'), 'sfk1_secret-value');
  });

  test('refuses tampered values, other purposes and other keys', () => {
    const stored = secrets.encryptSecret('secret', 'purpose-a');
    const tampered = stored.slice(0, -2) + (stored.endsWith('AA') ? 'BB' : 'AA');
    assert.throws(() => secrets.decryptSecret(tampered, 'purpose-a'));
    assert.throws(() => secrets.decryptSecret(stored, 'purpose-b'));
    process.env.ORION_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64');
    assert.throws(() => secrets.decryptSecret(stored, 'purpose-a'));
    process.env.ORION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  });

  test('explains a missing or malformed ORION_ENCRYPTION_KEY', () => {
    process.env.ORION_ENCRYPTION_KEY = '';
    assert.throws(() => secrets.encryptSecret('x', 'p'), secrets.EncryptionKeyError);
    process.env.ORION_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    assert.throws(() => secrets.encryptSecret('x', 'p'), /32 random bytes/);
    process.env.ORION_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  });
});

describe('API client against a ServiceFlow stand-in', () => {
  let site: FakeSite;
  before(async () => {
    site = await startFakeServiceFlow();
  });
  after(() => site.close());
  beforeEach(() => {
    site.failWith = null;
    site.clockOffset = 0;
    site.plainPermalinks = false;
    site.requests = [];
  });

  test('GET /connection is signed, typed, and captures X-SF-Server-Time', async () => {
    const res = await api.getConnection(parse(site.key));
    assert.equal(res.data.site.name, 'Fake ServiceFlow');
    assert.equal(res.data.connection.id, site.connectionId);
    assert.equal(typeof res.data.linking.available, 'boolean');
    assert.ok(res.serverTime && Math.abs(res.serverTime - Date.now() / 1000) < 5);
    assert.equal(site.requests[0].valid, true);
  });

  test('works with a plain-permalink REST root', async () => {
    site.plainPermalinks = true;
    const res = await api.getOrderCounts(parse(site.makeKey()));
    assert.deepEqual(res.data, COUNTS);
    assert.equal(site.requests[0].route, '/serviceflow/v1/orders/counts');
  });

  test('query strings with awkward characters sign correctly', async () => {
    const res = await api.listOrders(parse(site.key), {
      search: "it's (a)*b! & 100% café+more",
      include: [3, 1, 2],
      status: 'all',
      per_page: 100,
    });
    assert.equal(site.requests[0].valid, true);
    assert.equal(site.requests[0].query.search, "it's (a)*b! & 100% café+more");
    assert.equal(site.requests[0].query.include, '3,1,2');
    assert.equal(res.total, 42);
    assert.equal(res.totalPages, 3);
  });

  test('maps every contract §4 error code to an ApiError', async () => {
    const key = parse(site.key);
    for (const code of API_ERROR_CODES.filter((c) => c !== 'sf_api_signature_expired' && c !== 'sf_api_replayed')) {
      site.failWith = { status: code.includes('link') || code === 'sf_api_forbidden' ? 403 : 401, code };
      await assert.rejects(api.getConnection(key), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, code);
        assert.ok(err.explanation.length > 0);
        return true;
      });
    }
    const kinds: Record<string, string> = {
      sf_api_connection_revoked: 'connection',
      sf_api_connection_unknown: 'connection',
      sf_api_link_mismatch: 'link',
      sf_api_forbidden: 'forbidden',
      sf_api_order_not_found: 'not_found',
      sf_api_bad_nonce: 'request',
    };
    for (const [code, kind] of Object.entries(kinds)) {
      assert.equal(new ApiError(code, 401, 'x').kind, kind, code);
    }
  });

  test("a wrong signing key is rejected as sf_api_signature_invalid", async () => {
    const wrong = parse(site.makeKey({ key: Buffer.alloc(32, 5).toString('base64url') }));
    await assert.rejects(api.getConnection(wrong), { code: 'sf_api_signature_invalid' });
  });

  test("a wrong connection ID is rejected as sf_api_connection_unknown", async () => {
    const wrong = parse(site.makeKey({ id: '00000000-0000-0000-0000-000000000000' }));
    await assert.rejects(api.getConnection(wrong), { code: 'sf_api_connection_unknown', kind: 'connection' });
  });

  test('recovers from clock skew by re-signing with the site clock', async () => {
    site.clockOffset = 1000;
    const res = await api.getConnection(parse(site.key));
    assert.equal(res.status, 200);
    assert.equal(site.requests.length, 2, 'one rejected, one retried');
    // Learned: the next request is signed with the corrected clock first time.
    await api.getConnection(parse(site.key));
    assert.equal(site.requests.length, 3);
  });

  test('reports an unreachable site, a non-API answer, and a redirect, with specifics', async () => {
    const closedPort = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const offline = parse(site.makeKey({ api: `http://127.0.0.1:${closedPort}/wp-json/` }));
    await assert.rejects(api.getConnection(offline), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'orion_unreachable');
      assert.equal(err.kind, 'unreachable');
      assert.match(err.detail ?? '', new RegExp(`^ECONNREFUSED connecting to 127\\.0\\.0\\.1:${closedPort}: the host refused`));
      return true;
    });

    const key = parse(site.key);
    await assert.rejects(apiRequest(key, '/not-json'), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'orion_bad_response');
      assert.match(err.detail ?? '', /^HTTP 200 from 127\.0\.0\.1:\d+, text\/html, not JSON/);
      return true;
    });
    await assert.rejects(apiRequest(key, '/redirect-me'), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'orion_bad_response');
      assert.match(err.detail ?? '', /^HTTP 301 redirect from 127\.0\.0\.1:\d+ to elsewhere\.example:443/);
      return true;
    });
  });

  test('reports a timeout with the host it waited on', async () => {
    const silent = createServer(() => {}); // Accepts, never answers.
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const key = parse(site.makeKey({ api: `http://127.0.0.1:${port}/wp-json/` }));
      await assert.rejects(apiRequest(key, '/serviceflow/v1/connection', { timeoutMs: 300 }), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.match(err.detail ?? '', new RegExp(`^ETIMEDOUT: no answer from 127\\.0\\.0\\.1:${port}`));
        return true;
      });
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
  });

  test("reports a host name that doesn't resolve", async () => {
    const key = parse(site.makeKey({ api: 'https://sfwptest.nonexistent.invalid/wp-json/' }));
    await assert.rejects(api.getConnection(key), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      // ENOTFOUND normally; EAI_AGAIN where DNS itself is unavailable (as in the sandbox).
      assert.match(err.detail ?? '', /^(ENOTFOUND|EAI_AGAIN) connecting to sfwptest\.nonexistent\.invalid:443: /);
      return true;
    });
  });

  test("names TLS and dual-stack failures from fetch's error chain", () => {
    const url = 'https://sfwptest.server.wanoreck.com/wp-json/serviceflow/v1/connection';
    const tls = new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
    });
    assert.equal(
      describeNetworkFailure(tls, url),
      "CERT_HAS_EXPIRED connecting to sfwptest.server.wanoreck.com:443: the site's TLS certificate has expired (certificate has expired)",
    );
    const dualStack = new TypeError('fetch failed', {
      cause: new AggregateError([
        Object.assign(new Error('connect ECONNREFUSED ::1:443'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
      ]),
    });
    assert.match(describeNetworkFailure(dualStack, url), /^ECONNREFUSED connecting to sfwptest\.server\.wanoreck\.com:443: the host refused/);
    const unknown = new TypeError('fetch failed', { cause: Object.assign(new Error('weird failure'), { code: 'E_SOMETHING_NEW' }) });
    assert.equal(describeNetworkFailure(unknown, url), 'E_SOMETHING_NEW connecting to sfwptest.server.wanoreck.com:443: weird failure');
  });

  test("API errors carry the HTTP status, host and the site's message", async () => {
    site.failWith = { status: 401, code: 'sf_api_connection_revoked' };
    await assert.rejects(api.getConnection(parse(site.key)), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.match(err.detail ?? '', /^HTTP 401 from 127\.0\.0\.1:\d+: sf_api_connection_revoked: fake: sf_api_connection_revoked$/);
      return true;
    });
  });

  test('error details never include the key, the signature, or the query string', async () => {
    const seed = JSON.parse(Buffer.from(site.key.slice(5), 'base64url').toString()).key as string;
    const failures: InstanceType<typeof ApiError>[] = [];
    const key = parse(site.key);
    for (const run of [
      () => api.listOrders(parse(site.makeKey({ api: 'http://127.0.0.1:9/wp-json/' })), { search: 'needle-in-query' }),
      () => apiRequest(key, '/not-json', { query: { search: 'needle-in-query' } }),
      () => apiRequest(key, '/redirect-me'),
      () => { site.failWith = { status: 401, code: 'sf_api_signature_invalid' }; return api.listOrders(key, { search: 'needle-in-query' }); },
    ]) {
      try {
        await run();
      } catch (err) {
        assert.ok(err instanceof ApiError);
        failures.push(err);
      }
    }
    assert.equal(failures.length, 4);
    for (const err of failures) {
      for (const text of [err.message, err.detail ?? '', err.explanation]) {
        assert.ok(!text.includes(seed), 'no private key');
        assert.ok(!text.includes('sfk1_'), 'no connection key');
        assert.ok(!/signature:|X-SF-Signature|X-SF-Nonce/i.test(text), 'no signature headers');
        assert.ok(!text.includes('needle-in-query'), 'no query string');
      }
    }
  });
});
