import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { clearTables, closeDatabase, resetDatabase } from '../helpers.mts';
import { startFakeServiceFlow, type FakeSite } from '../fake-serviceflow.mts';

process.env.ORION_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

const accounts = await import('@/auth/accounts');
const links = await import('@/serviceflow/links');
const { parseConnectionKey } = await import('@/serviceflow/key');
const { getMe } = await import('@/serviceflow/api');

let site: FakeSite;
let userId = '';
let otherId = '';

function key(raw = site.key) {
  const parsed = parseConnectionKey(raw);
  assert.ok(parsed.ok);
  return parsed.key;
}

async function linkAs(login: string, forUser = userId) {
  const password = site.approve(login);
  const credential = { username: login, password };
  const { data: me } = await getMe(key(), credential);
  await links.saveLink(forUser, site.connectionId, credential, me);
  return password;
}

before(async () => {
  await resetDatabase();
  site = await startFakeServiceFlow();
});
after(async () => {
  await site.close();
  await closeDatabase();
});
beforeEach(async () => {
  await clearTables();
  site.appPasswords.clear();
  const admin = await accounts.createInitialAdmin({ email: 'a@example.com', name: 'A', password: 'correct horse battery' });
  const other = await accounts.createUser({ email: 'b@example.com', name: 'B', password: 'correct horse battery', role: 'user' });
  assert.ok(admin.ok && other.ok);
  userId = admin.value.id;
  otherId = other.value.id;
});

describe('link states', () => {
  test('are single-use, and only for the user and connection that started them', async () => {
    const token = await links.createLinkState(userId, 'conn-1');
    assert.equal(await links.consumeLinkState(token, userId, 'conn-1'), 'ok');
    assert.equal(await links.consumeLinkState(token, userId, 'conn-1'), 'unknown', 'already used');

    const forOther = await links.createLinkState(userId, 'conn-1');
    assert.equal(await links.consumeLinkState(forOther, otherId, 'conn-1'), 'wrong_user');
    assert.equal(await links.consumeLinkState(forOther, userId, 'conn-1'), 'unknown', 'a wrong attempt spends it');

    const otherConnection = await links.createLinkState(userId, 'conn-1');
    assert.equal(await links.consumeLinkState(otherConnection, userId, 'conn-2'), 'wrong_connection');
    assert.equal(await links.consumeLinkState('', userId, 'conn-1'), 'unknown');
    assert.equal(await links.consumeLinkState('made-up', userId, 'conn-1'), 'unknown');
  });

  test('expire after 10 minutes', async () => {
    const start = new Date();
    const token = await links.createLinkState(userId, 'conn-1', start);
    assert.equal(await links.consumeLinkState(token, userId, 'conn-1', new Date(start.getTime() + 10 * 60 * 1000 + 1)), 'expired');
  });

  test('store only a hash of the token', async () => {
    const token = await links.createLinkState(userId, 'conn-1');
    const { sql } = await import('@/db');
    const [row] = await sql()`select id from link_states`;
    assert.notEqual(row.id, token);
    assert.match(row.id, /^[0-9a-f]{64}$/);
  });
});

describe('stored links', () => {
  test('keep the Application Password only encrypted, bound to user and connection', async () => {
    const password = await linkAs('ada');
    const { sql } = await import('@/db');
    const [row] = await sql()`select * from account_links`;
    assert.ok(!JSON.stringify(row).includes(password), 'no plaintext password in the row');
    assert.ok(!JSON.stringify(row).includes(password.replace(/ /g, '')));
    assert.equal(row.wp_name, 'WP ada');

    const link = await links.getLink(userId, site.connectionId);
    assert.deepEqual(links.decryptCredential(link!), { username: 'ada', password });

    // Moved to another user's row, the ciphertext no longer decrypts.
    await linkAs('bob', otherId);
    await sql()`update account_links set encrypted_credential = ${row.encrypted_credential} where user_id = ${otherId}`;
    const moved = await links.getLink(otherId, site.connectionId);
    assert.throws(() => links.decryptCredential(moved!));
  });

  test('are per connection, so other connections keep theirs (D3)', async () => {
    await linkAs('ada');
    assert.ok(await links.getLink(userId, site.connectionId));
    assert.equal(await links.getLink(userId, 'another-connection'), null);
    assert.equal(await links.deleteLink(userId, 'another-connection'), false);
    assert.equal(await links.deleteLink(userId, site.connectionId), true);
    assert.equal(await links.getLink(userId, site.connectionId), null);
  });
});

describe('checking a link', () => {
  test('is ok while WordPress accepts the password', async () => {
    await linkAs('ada');
    const check = await links.checkLink(userId, key());
    assert.equal(check.state, 'ok');
    assert.equal(check.state === 'ok' && check.me.username, 'ada');
  });

  test('marks the link broken on a 401, and a relink repairs it', async () => {
    await linkAs('ada');
    site.appPasswords.get('ada')!.revoked = true;
    const check = await links.checkLink(userId, key());
    assert.equal(check.state, 'broken');
    assert.equal(check.state === 'broken' && check.code, 'incorrect_password');
    assert.equal((await links.getLink(userId, site.connectionId))?.status, 'broken');

    await linkAs('ada');
    assert.equal((await links.getLink(userId, site.connectionId))?.status, 'ok');
    assert.equal((await links.checkLink(userId, key())).state, 'ok');
  });

  test('marks it broken on sf_api_link_mismatch', async () => {
    await linkAs('ada');
    site.failWith = { status: 403, code: 'sf_api_link_mismatch' };
    try {
      assert.equal((await links.checkLink(userId, key())).state, 'broken');
    } finally {
      site.failWith = null;
    }
  });

  test("doesn't mark it broken when the site is just unreachable", async () => {
    await linkAs('ada');
    const offline = key(site.makeKey({ api: 'http://127.0.0.1:9/wp-json/' }));
    const check = await links.checkLink(userId, offline);
    assert.equal(check.state, 'unknown');
    assert.equal((await links.getLink(userId, site.connectionId))?.status, 'ok');
  });

  test('is none without a link', async () => {
    assert.equal((await links.checkLink(userId, key())).state, 'none');
  });
});
