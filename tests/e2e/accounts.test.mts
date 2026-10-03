// End-to-end: accounts, against the production build (see harness.mts).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, resetDatabase } from '../helpers.mts';
import { COOKIE, PASSWORD, hiddenFields, redirectsTo, sessionCookie, startOrion, type Orion } from './harness.mts';

let orion: Orion;
let BASE = '';
const get = (path: string, cookie?: string) => orion.get(path, cookie);
const submit = (...args: Parameters<Orion['submit']>) => orion.submit(...args);

before(async () => {
  await resetDatabase();
  orion = await startOrion(3999);
  BASE = orion.base;
});

after(async () => {
  orion?.stop();
  await closeDatabase();
});

test('accounts, end to end', async (t) => {
  let adminCookie = '';
  let userCookie = '';

  await t.test('with no accounts, everything leads to first-run setup', async () => {
    redirectsTo(await get('/'), '/setup');
    redirectsTo(await get('/login'), '/setup');
    redirectsTo(await get('/users'), '/setup');
  });

  await t.test('setup rejects mismatched passwords and keeps what was typed', async () => {
    const page = await submit('/setup', 'name="confirm"', {
      name: 'Ada Admin', email: 'ada@example.com', password: PASSWORD, confirm: 'something else!!',
    });
    assert.equal(page.status, 200);
    assert.match(page.html, /passwords don(&#x27;|')t match/);
    assert.match(page.html, /value="ada@example.com"/);
    assert.ok(!page.html.includes(PASSWORD), 'password not echoed');
  });

  await t.test('setup creates the Admin and signs them in with a hardened cookie', async () => {
    const page = await submit('/setup', 'name="confirm"', {
      name: 'Ada Admin', email: 'ada@example.com', password: PASSWORD, confirm: PASSWORD,
    });
    redirectsTo(page, '/');
    const header = page.setCookie.find((c) => c.startsWith(`${COOKIE}=`))!;
    for (const flag of [/HttpOnly/i, /Secure/i, /SameSite=lax/i, /Path=\//, /Max-Age=2592000/]) {
      assert.match(header, flag);
    }
    adminCookie = sessionCookie(page);
    const home = await get('/', adminCookie);
    assert.equal(home.status, 200);
    assert.match(home.html, /Welcome, Ada Admin/);
    assert.match(home.html, /href="\/users"/);
  });

  await t.test('setup is closed once an account exists', async () => {
    redirectsTo(await get('/setup'), '/login');
  });

  await t.test('the Admin creates a User', async () => {
    const page = await submit('/users', 'Initial password', {
      name: 'Uma User', email: 'Uma@Example.com', role: 'user', password: PASSWORD,
    }, adminCookie);
    assert.equal(page.status, 200);
    assert.match(page.html, /Created uma@example.com/);
    const dupe = await submit('/users', 'Initial password', {
      name: 'Again', email: 'uma@example.com', role: 'user', password: PASSWORD,
    }, adminCookie);
    assert.match(dupe.html, /already exists/);
  });

  await t.test('sign-in rejects a wrong password with a generic message', async () => {
    const page = await submit('/login', 'current-password', { email: 'uma@example.com', password: 'wrong password!!' });
    assert.equal(page.status, 200);
    assert.match(page.html, /Incorrect email or password/);
    assert.ok(!page.setCookie.some((c) => c.startsWith(`${COOKIE}=`)));
  });

  await t.test('a User signs in, but cannot reach Admin pages', async () => {
    const page = await submit('/login', 'current-password', { email: 'uma@example.com', password: PASSWORD });
    redirectsTo(page, '/');
    userCookie = sessionCookie(page);
    const home = await get('/', userCookie);
    assert.match(home.html, /Welcome, Uma User/);
    assert.ok(!home.html.includes('href="/users"'), 'no Users link for a User');
    redirectsTo(await get('/users', userCookie), '/');
    redirectsTo(await get('/login', userCookie), '/');
  });

  await t.test("a User can't call the Admin action directly", async () => {
    // Borrow the Admin's create-user form, but post it with the User's session.
    const adminForm = await get('/users', adminCookie);
    const body = hiddenFields(adminForm.html, 'Initial password');
    for (const [k, v] of Object.entries({ name: 'Sneaky', email: 'sneaky@example.com', role: 'admin', password: PASSWORD })) {
      body.append(k, v);
    }
    await fetch(`${BASE}/users`, { method: 'POST', body, redirect: 'manual', headers: { origin: BASE, cookie: userCookie } });
    const list = await get('/users', adminCookie);
    assert.ok(!list.html.includes('sneaky@example.com'), 'no account was created');
  });

  await t.test('deactivating the User signs them out immediately', async () => {
    const list = await get('/users', adminCookie);
    const userId = /name="userId" value="([0-9a-f-]{36})"/.exec(list.html)?.[1];
    assert.ok(userId);
    const page = await submit('/users', `value="${userId}"`, {}, adminCookie);
    assert.match(page.html, /Account deactivated/);
    redirectsTo(await get('/', userCookie), '/login');
    const again = await submit('/login', 'current-password', { email: 'uma@example.com', password: PASSWORD });
    assert.match(again.html, /Incorrect email or password/);
  });

  await t.test('sign-out ends the session', async () => {
    const page = await submit('/', 'Sign out', {}, adminCookie);
    redirectsTo(page, '/login');
    redirectsTo(await get('/', adminCookie), '/login');
  });

  await t.test('cross-site form posts are refused, even with the right password', async () => {
    const page = await submit('/login', 'current-password', { email: 'ada@example.com', password: PASSWORD },
      undefined, 'https://evil.example');
    assert.notEqual(page.status, 303);
    assert.ok(!page.setCookie.some((c) => c.startsWith(`${COOKIE}=`)), 'no session from a foreign origin');
    // The same post from Orion's own origin works.
    redirectsTo(await submit('/login', 'current-password', { email: 'ada@example.com', password: PASSWORD }), '/');
  });
});
