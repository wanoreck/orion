// End-to-end: linking an Orion account to a WordPress user (D6, contract §3). The test plays
// WordPress's part: it reads Orion's redirect to the authorize page, "approves" (the fake
// site issues an Application Password), and follows the callback like the browser would.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, resetDatabase } from '../helpers.mts';
import { startFakeServiceFlow, type FakeSite } from '../fake-serviceflow.mts';
import { PASSWORD, redirectsTo, sessionCookie, setUpAdmin, startOrion, type Orion } from './harness.mts';

const PUBLIC_URL = 'https://orion.example.test';
let orion: Orion;
let site: FakeSite;
const issuedPasswords: string[] = [];

before(async () => {
  await resetDatabase();
  site = await startFakeServiceFlow();
  site.linkingAvailable = true;
  orion = await startOrion(3996, { ORION_PUBLIC_URL: PUBLIC_URL });
});

after(async () => {
  orion?.stop();
  await site?.close();
  await closeDatabase();
});

/** Clicks "Link…" on /account and returns where Orion sent the browser. */
async function startLink(cookie: string, button = 'Link WordPress account') {
  const page = await orion.submit('/account', button, {}, cookie);
  assert.equal(page.status, 303, 'redirected to WordPress');
  const authorize = new URL(page.location!);
  return {
    authorize,
    success: new URL(authorize.searchParams.get('success_url')!),
    reject: new URL(authorize.searchParams.get('reject_url')!),
  };
}

/** Follows a callback URL (pointing at PUBLIC_URL) on the test server, with WordPress's added params. */
async function callback(url: URL, cookie: string, extra: Record<string, string>) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(extra)) target.searchParams.set(k, v);
  return fetch(`${orion.base}${target.pathname}${target.search}`, { redirect: 'manual', headers: { cookie } });
}

function approve(login: string) {
  const password = site.approve(login);
  issuedPasswords.push(password);
  return { site_url: site.url, user_login: login, password };
}

test('account linking, end to end', async (t) => {
  const admin = await setUpAdmin(orion);
  assert.match((await orion.submit('/settings', 'name="key"', { key: site.key }, admin)).html, /Connected to/);
  await orion.submit('/users', 'Initial password', { name: 'Uma User', email: 'uma@example.com', role: 'user', password: PASSWORD }, admin);
  const user = sessionCookie(await orion.submit('/login', 'current-password', { email: 'uma@example.com', password: PASSWORD }));

  await t.test('unlinked accounts are told they are read-only, everywhere', async () => {
    for (const path of ['/', '/account']) {
      const page = await orion.get(path, user);
      assert.match(page.html, /Not linked: read-only/, path);
    }
    assert.match((await orion.get('/account', user)).html, /Link WordPress account/);
  });

  await t.test('Link sends the browser to WordPress with the contract §3 parameters', async () => {
    const { authorize, success, reject } = await startLink(admin);
    assert.equal(`${authorize.origin}${authorize.pathname}`, `${site.url}/wp-admin/authorize-application.php`);
    assert.equal(authorize.searchParams.get('app_name'), 'Orion');
    assert.equal(authorize.searchParams.get('app_id'), 'x');
    for (const url of [success, reject]) {
      assert.equal(url.origin, PUBLIC_URL, 'https Orion URL');
      assert.equal(url.pathname, '/account/link/callback');
      assert.match(url.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{43}$/);
    }
  });

  let firstSuccess: URL;
  let firstApproval: Record<string, string>;
  await t.test('approving links the account, verified with GET /me', async () => {
    const { success } = await startLink(admin);
    firstSuccess = success;
    firstApproval = approve('ada');
    const res = await callback(success, admin, firstApproval);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/account?linked=1');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const account = await orion.get('/account?linked=1', admin);
    assert.match(account.html, /Your WordPress account is linked/);
    assert.match(account.html, /WP ada \(ada\)/);
    assert.match(account.html, /Orion \(test\)/);
    assert.match(account.html, /Unlink WordPress account/);
    const home = await orion.get('/', admin);
    assert.doesNotMatch(home.html, /read-only/);
  });

  await t.test('a callback URL works once only', async () => {
    const res = await callback(firstSuccess, admin, firstApproval);
    assert.equal(res.headers.get('location'), '/account?link_error=orion_link_state_unknown');
    assert.match((await orion.get('/account', admin)).html, /WP ada \(ada\)/, 'existing link untouched');
  });

  await t.test("another Orion user can't complete someone else's link", async () => {
    // The User starts a link; the Admin (already linked as ada) tries to finish it.
    const { success } = await startLink(user);
    const res = await callback(success, admin, approve('mallory'));
    assert.equal(res.headers.get('location'), '/account?link_error=orion_link_state_wrong_user');
    assert.match((await orion.get('/account', user)).html, /Not linked: read-only/);
    assert.match((await orion.get('/account', admin)).html, /WP ada \(ada\)/, "admin's link unchanged");
  });

  await t.test('declining in WordPress links nothing, and says so', async () => {
    const { reject } = await startLink(user);
    const res = await callback(reject, user, { success: 'false' });
    assert.equal(res.headers.get('location'), '/account?link_error=orion_link_rejected');
    const account = await orion.get(res.headers.get('location')!, user);
    assert.match(account.html, /declined in WordPress/);
    assert.match(account.html, /orion_link_rejected/);
    assert.match(account.html, /Not linked: read-only/);
  });

  await t.test('a callback claiming another site, or with a bad password, is refused', async () => {
    let { success } = await startLink(user);
    let res = await callback(success, user, { ...approve('uma'), site_url: 'https://evil.example' });
    assert.equal(res.headers.get('location'), '/account?link_error=orion_link_wrong_site');
    ({ success } = await startLink(user));
    res = await callback(success, user, { site_url: site.url, user_login: 'uma', password: 'not a real password' });
    assert.equal(res.headers.get('location'), '/account?link_error=incorrect_password');
    assert.match((await orion.get('/account', user)).html, /Not linked: read-only/);
  });

  await t.test('a revoked Application Password marks the link broken and asks to relink', async () => {
    site.appPasswords.get('ada')!.revoked = true;
    const account = await orion.get('/account', admin);
    assert.match(account.html, /Your WordPress link stopped working/);
    assert.match(account.html, /incorrect_password/);
    assert.match(account.html, /Link again/);
    assert.match((await orion.get('/', admin)).html, /Your WordPress link stopped working: read-only/);

    const { success } = await startLink(admin, 'Link again');
    const res = await callback(success, admin, approve('ada'));
    assert.equal(res.headers.get('location'), '/account?linked=1');
    assert.match((await orion.get('/account', admin)).html, /Linked/);
    assert.doesNotMatch((await orion.get('/', admin)).html, /read-only/);
  });

  await t.test('Unlink removes the stored credential', async () => {
    const page = await orion.submit('/account', 'Unlink WordPress account', {}, admin);
    assert.match(page.html, /Unlinked/);
    assert.match((await orion.get('/account', admin)).html, /Not linked: read-only/);
    const { sql } = await import('@/db');
    const rows = await sql()`select 1 from account_links al join users u on u.id = al.user_id where u.email = 'ada@example.com'`;
    assert.equal(rows.length, 0);
  });

  await t.test("when the site doesn't offer linking, Account explains instead of offering it", async () => {
    site.linkingAvailable = false;
    try {
      const account = await orion.get('/account', user);
      assert.match(account.html, /doesn(&#x27;|')t offer account linking/);
      assert.doesNotMatch(account.html, /Link WordPress account<\/button>/);
    } finally {
      site.linkingAvailable = true;
    }
  });

  await t.test('no Application Password ever appears in a page', async () => {
    const pages = await Promise.all(['/', '/account', '/users', '/settings'].map((p) => orion.get(p, admin)));
    for (const password of issuedPasswords) {
      for (const page of pages) assert.ok(!page.html.includes(password));
    }
    const { sql } = await import('@/db');
    const rows = await sql()`select * from account_links`;
    for (const password of issuedPasswords) assert.ok(!JSON.stringify(rows).includes(password));
  });
});
