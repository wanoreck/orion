// End-to-end: the ServiceFlow connection (Settings, the no-connection notice, the API client
// and order counts), against the production build and a ServiceFlow stand-in.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, resetDatabase } from '../helpers.mts';
import { startFakeServiceFlow, type FakeSite } from '../fake-serviceflow.mts';
import { PASSWORD, redirectsTo, sessionCookie, setUpAdmin, startOrion, type Orion } from './harness.mts';

let orion: Orion;
let site: FakeSite;

before(async () => {
  await resetDatabase();
  site = await startFakeServiceFlow();
  orion = await startOrion(3998);
});

after(async () => {
  orion?.stop();
  await site?.close();
  await closeDatabase();
});

const NOTICE = "Orion isn&#x27;t connected to a ServiceFlow site yet";

test('ServiceFlow connection, end to end', async (t) => {
  let admin = '';
  let user = '';

  await t.test('with no key, pages load and show the notice (D4)', async () => {
    admin = await setUpAdmin(orion);
    const home = await orion.get('/', admin);
    assert.equal(home.status, 200);
    assert.ok(home.html.includes(NOTICE));
    assert.match(home.html, /href="\/settings"/);
    const created = await orion.submit('/users', 'Initial password', {
      name: 'Uma User', email: 'uma@example.com', role: 'user', password: PASSWORD,
    }, admin);
    assert.match(created.html, /Created uma@example.com/);
    user = sessionCookie(await orion.submit('/login', 'current-password', { email: 'uma@example.com', password: PASSWORD }));
    const userHome = await orion.get('/', user);
    assert.ok(userHome.html.includes(NOTICE));
    assert.match(userHome.html, /Ask an Admin/);
    assert.ok(!userHome.html.includes('href="/settings"'));
  });

  await t.test('Settings is Admin only', async () => {
    redirectsTo(await orion.get('/settings', user), '/');
    assert.equal((await orion.get('/settings', admin)).status, 200);
  });

  await t.test('a malformed key is refused before contacting the site', async () => {
    site.requests = [];
    const page = await orion.submit('/settings', 'name="key"', { key: 'not-a-key' }, admin);
    assert.match(page.html, /Keys start with/);
    assert.match(page.html, /orion_key_format/);
    assert.equal(site.requests.length, 0);
  });

  await t.test("a key the site doesn't recognize shows the API's error code and isn't saved", async () => {
    const unknown = site.makeKey({ id: '00000000-0000-0000-0000-000000000000' });
    const page = await orion.submit('/settings', 'name="key"', { key: unknown }, admin);
    assert.match(page.html, /Verification failed, so the key was not saved/);
    assert.match(page.html, /sf_api_connection_unknown/);
    assert.ok((await orion.get('/', admin)).html.includes(NOTICE), 'still not connected');
  });

  await t.test('a valid key is verified, saved, and never sent back to the browser', async () => {
    const page = await orion.submit('/settings', 'name="key"', { key: site.key }, admin);
    assert.match(page.html, /Connected to Fake ServiceFlow/);
    assert.ok(site.requests.at(-1)?.valid, 'signed GET /connection');

    const settings = await orion.get('/settings', admin);
    for (const text of ['Fake ServiceFlow', '1.5.0', '0.2.0', 'Not available: the site needs HTTPS', site.connectionId, 'Replace key']) {
      assert.ok(settings.html.includes(text), `settings shows ${text}`);
    }
    const seed = JSON.parse(Buffer.from(site.key.slice(5), 'base64url').toString()).key as string;
    for (const html of [page.html, settings.html, (await orion.get('/', admin)).html]) {
      assert.ok(!html.includes(site.key), 'key not in the page');
      assert.ok(!html.includes(seed), 'private key not in the page');
    }
  });

  await t.test('the key is encrypted at rest', async () => {
    const { sql } = await import('@/db');
    const [row] = await sql()`select value from settings where key = 'serviceflow_connection'`;
    const stored = JSON.stringify(row.value);
    assert.ok(!stored.includes(site.key.slice(5, 40)), 'no plaintext key in the database');
    assert.match(row.value.encryptedKey, /^v1\./);
  });

  await t.test('once connected, the notice is gone and everyone sees order counts', async () => {
    for (const cookie of [admin, user]) {
      const home = await orion.get('/', cookie);
      assert.ok(!home.html.includes(NOTICE));
      assert.match(home.html, /Active: 7/);
      assert.match(home.html, /In Progress: 3/);
      assert.match(home.html, /All: 26/);
    }
  });

  await t.test('API errors show their code instead of breaking the page', async () => {
    site.failWith = { status: 401, code: 'sf_api_connection_revoked' };
    const home = await orion.get('/', user);
    assert.equal(home.status, 200);
    assert.match(home.html, /revoked in ServiceFlow/);
    assert.match(home.html, /sf_api_connection_revoked/);
    const settings = await orion.get('/settings', admin);
    assert.match(settings.html, /The connection isn(&#x27;|')t working/);
    assert.match(settings.html, /sf_api_connection_revoked/);
    site.failWith = null;
  });

  await t.test('replacing the key with a working one switches sites', async () => {
    const other = await startFakeServiceFlow();
    try {
      other.plainPermalinks = true;
      const page = await orion.submit('/settings', 'name="key"', { key: other.makeKey() }, admin);
      assert.match(page.html, /Connected to Fake ServiceFlow/);
      const settings = await orion.get('/settings', admin);
      assert.ok(settings.html.includes(other.connectionId));
      assert.ok(settings.html.includes(other.url));
      await orion.get('/', user);
      assert.ok(other.requests.some((r) => r.route === '/serviceflow/v1/orders/counts' && r.valid));
    } finally {
      await other.close();
    }
  });

  await t.test('a User cannot save a key by posting the form directly', async () => {
    const before = (await orion.get('/settings', admin)).html;
    const { hiddenFields } = await import('./harness.mts');
    const body = hiddenFields(before, 'name="key"');
    body.append('key', site.key);
    await fetch(`${orion.base}/settings`, { method: 'POST', body, redirect: 'manual', headers: { origin: orion.base, cookie: user } });
    const after = await orion.get('/settings', admin);
    assert.ok(!after.html.includes(site.url), 'connection unchanged');
  });
});
