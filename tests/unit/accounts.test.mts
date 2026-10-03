import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { clearTables, closeDatabase, resetDatabase } from '../helpers.mts';

const accounts = await import('@/auth/accounts');
const session = await import('@/auth/session');
const rateLimit = await import('@/auth/rate-limit');

const PASSWORD = 'correct horse battery';
const admin = { email: 'Admin@Example.com ', name: ' Ada Admin ', password: PASSWORD };

before(resetDatabase);
beforeEach(clearTables);
after(closeDatabase);

async function setupAdmin() {
  const result = await accounts.createInitialAdmin(admin);
  assert.ok(result.ok, !result.ok ? result.error : '');
  return result.value;
}

describe('first-run setup', () => {
  test('creates an Admin with a normalized email and an Argon2id hash', async () => {
    assert.equal(await accounts.hasAnyUsers(), false);
    const created = await setupAdmin();
    assert.equal(created.email, 'admin@example.com');
    assert.equal(created.name, 'Ada Admin');
    assert.equal(created.role, 'admin');
    assert.equal(await accounts.hasAnyUsers(), true);
    const { sql } = await import('@/db');
    const [row] = await sql()`select password_hash from users`;
    assert.match(row.password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.ok(!row.password_hash.includes(PASSWORD));
  });

  test('is refused once any account exists', async () => {
    await setupAdmin();
    const again = await accounts.createInitialAdmin({ ...admin, email: 'other@example.com' });
    assert.equal(again.ok, false);
  });

  test('lets exactly one of several simultaneous setups win', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => accounts.createInitialAdmin({ ...admin, email: `a${i}@example.com` })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await accounts.listUsers()).length, 1);
  });

  test('validates its fields', async () => {
    const cases: [Partial<typeof admin>, RegExp][] = [
      [{ email: 'not-an-email' }, /valid email/],
      [{ name: '   ' }, /name/],
      [{ password: 'short' }, /at least 12/],
      [{ password: 'x'.repeat(257) }, /at most 256/],
    ];
    for (const [change, message] of cases) {
      const result = await accounts.createInitialAdmin({ ...admin, ...change });
      assert.equal(result.ok, false);
      assert.match(!result.ok ? result.error : '', message);
    }
    assert.equal(await accounts.hasAnyUsers(), false);
  });
});

describe('sign-in', () => {
  test('accepts the right password, with any email capitalization', async () => {
    const created = await setupAdmin();
    const user = await accounts.authenticate('  ADMIN@example.COM', PASSWORD);
    assert.equal(user?.id, created.id);
    const [listed] = await accounts.listUsers();
    assert.ok(listed.lastLoginAt);
  });

  test('rejects wrong passwords, unknown emails and deactivated accounts alike', async () => {
    const created = await setupAdmin();
    assert.equal(await accounts.authenticate(admin.email, 'wrong password!!'), null);
    assert.equal(await accounts.authenticate('nobody@example.com', PASSWORD), null);
    assert.equal(await accounts.authenticate(admin.email, ''), null);
    const user = await accounts.createUser({ email: 'u@example.com', name: 'U', password: PASSWORD, role: 'user' });
    assert.ok(user.ok);
    assert.ok((await accounts.setUserActive(created.id, user.value.id, false)).ok);
    assert.equal(await accounts.authenticate('u@example.com', PASSWORD), null);
  });

  test('throttles repeated failures per email', () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      assert.equal(rateLimit.isSignInBlocked('x@example.com', 'ip-a', now), false);
      rateLimit.recordSignInFailure('x@example.com', 'ip-a', now);
    }
    assert.equal(rateLimit.isSignInBlocked('x@example.com', 'ip-b', now), true);
    assert.equal(rateLimit.isSignInBlocked('y@example.com', 'ip-b', now), false);
    // The window passes.
    assert.equal(rateLimit.isSignInBlocked('x@example.com', 'ip-a', now + 15 * 60 * 1000), false);
  });
});

describe('sessions', () => {
  test('a token identifies its user; only its hash is stored', async () => {
    const created = await setupAdmin();
    const token = await session.createSession(created.id);
    assert.equal((await session.validateSessionToken(token))?.id, created.id);
    assert.equal(await session.validateSessionToken('not-a-real-token'), null);
    const { sql } = await import('@/db');
    const [row] = await sql()`select id from sessions`;
    assert.notEqual(row.id, token);
    assert.match(row.id, /^[0-9a-f]{64}$/);
  });

  test('expire after the idle limit', async () => {
    const created = await setupAdmin();
    const start = new Date('2026-01-01T00:00:00Z');
    const token = await session.createSession(created.id, start);
    const later = new Date(start.getTime() + session.SESSION_IDLE_MS + 1);
    assert.equal(await session.validateSessionToken(token, later), null);
    // Expired sessions are deleted, not just ignored.
    assert.equal(await session.validateSessionToken(token, start), null);
  });

  test('are extended while in use, but never past the absolute limit', async () => {
    const created = await setupAdmin();
    const start = new Date('2026-01-01T00:00:00Z');
    const token = await session.createSession(created.id, start);
    const day = 24 * 60 * 60 * 1000;
    let t = start.getTime();
    // Use it every 5 days: it stays valid thanks to renewal…
    while (t + 5 * day < start.getTime() + session.SESSION_MAX_MS) {
      t += 5 * day;
      assert.ok(await session.validateSessionToken(token, new Date(t)), `valid on day ${(t - start.getTime()) / day}`);
    }
    // …until the absolute limit.
    assert.equal(await session.validateSessionToken(token, new Date(start.getTime() + session.SESSION_MAX_MS)), null);
  });

  test('stop working when the account is deactivated', async () => {
    const created = await setupAdmin();
    const user = await accounts.createUser({ email: 'u@example.com', name: 'U', password: PASSWORD, role: 'user' });
    assert.ok(user.ok);
    const token = await session.createSession(user.value.id);
    assert.ok(await session.validateSessionToken(token));
    await accounts.setUserActive(created.id, user.value.id, false);
    assert.equal(await session.validateSessionToken(token), null);
  });

  test('sign out everywhere can keep the current session', async () => {
    const created = await setupAdmin();
    const keep = await session.createSession(created.id);
    const drop = await session.createSession(created.id);
    await session.deleteUserSessions(created.id, keep);
    assert.ok(await session.validateSessionToken(keep));
    assert.equal(await session.validateSessionToken(drop), null);
    await session.deleteSession(keep);
    assert.equal(await session.validateSessionToken(keep), null);
  });
});

describe('account management', () => {
  test('creates Users and Admins, refusing duplicate emails', async () => {
    await setupAdmin();
    const user = await accounts.createUser({ email: 'U@Example.com', name: 'Uma', password: PASSWORD, role: 'user' });
    assert.ok(user.ok);
    assert.equal(user.value.role, 'user');
    const dupe = await accounts.createUser({ email: 'u@example.com', name: 'Dupe', password: PASSWORD, role: 'admin' });
    assert.equal(dupe.ok, false);
    assert.match(!dupe.ok ? dupe.error : '', /already exists/);
  });

  test('an Admin cannot deactivate themselves', async () => {
    const created = await setupAdmin();
    const result = await accounts.setUserActive(created.id, created.id, false);
    assert.equal(result.ok, false);
  });

  test('always keeps at least one active Admin', async () => {
    const first = await setupAdmin();
    const second = await accounts.createUser({ email: 'b@example.com', name: 'B', password: PASSWORD, role: 'admin' });
    assert.ok(second.ok);
    // Each tries to deactivate the other at the same moment: only one can succeed.
    const results = await Promise.all([
      accounts.setUserActive(first.id, second.value.id, false),
      accounts.setUserActive(second.value.id, first.id, false),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    const activeAdmins = (await accounts.listUsers()).filter((u) => u.role === 'admin' && u.active);
    assert.equal(activeAdmins.length, 1);
  });

  test('deactivated accounts can be reactivated', async () => {
    const created = await setupAdmin();
    const user = await accounts.createUser({ email: 'u@example.com', name: 'U', password: PASSWORD, role: 'user' });
    assert.ok(user.ok);
    assert.ok((await accounts.setUserActive(created.id, user.value.id, false)).ok);
    assert.ok((await accounts.setUserActive(created.id, user.value.id, true)).ok);
    assert.ok(await accounts.authenticate('u@example.com', PASSWORD));
  });

  test('password changes need the current password', async () => {
    const created = await setupAdmin();
    const wrong = await accounts.changePassword(created.id, 'not my password', 'a brand new password');
    assert.equal(wrong.ok, false);
    const weak = await accounts.changePassword(created.id, PASSWORD, 'short');
    assert.equal(weak.ok, false);
    assert.ok((await accounts.changePassword(created.id, PASSWORD, 'a brand new password')).ok);
    assert.equal(await accounts.authenticate(admin.email, PASSWORD), null);
    assert.ok(await accounts.authenticate(admin.email, 'a brand new password'));
  });
});
