// End-to-end: runs the production build (.next/standalone, so `npm run build` first) against
// TEST_DATABASE_URL and drives it over HTTP the way a browser does with JavaScript off:
// fetch a page, then post its form (Server Actions accept plain form posts).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { closeDatabase, resetDatabase } from '../helpers.mts';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const COOKIE = '__Host-orion_session';
const PASSWORD = 'correct horse battery';
let server: ChildProcess;

before(async () => {
  if (!existsSync('.next/standalone/server.js')) throw new Error('Run `npm run build` first');
  await resetDatabase();
  server = spawn('node', ['.next/standalone/server.js'], {
    env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(async () => {
  server?.kill();
  await closeDatabase();
});

type Page = { status: number; location: string | null; html: string; setCookie: string[] };

async function toPage(res: Response): Promise<Page> {
  // React separates adjacent text and values with <!-- --> markers; drop them for matching.
  const html = (await res.text()).replaceAll('<!-- -->', '');
  return { status: res.status, location: res.headers.get('location'), html, setCookie: res.headers.getSetCookie() };
}

async function get(path: string, cookie?: string): Promise<Page> {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return toPage(res);
}

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Posts the form on `path` that contains `marker`, with its hidden fields plus `fields`. */
async function submit(
  path: string,
  marker: string,
  fields: Record<string, string>,
  cookie?: string,
  origin = BASE,
): Promise<Page> {
  const page = await get(path, cookie);
  assert.equal(page.status, 200, `GET ${path}`);
  const form = page.html.split('<form').slice(1).map((f) => f.split('</form>')[0]).find((f) => f.includes(marker));
  assert.ok(form, `no form containing ${marker} on ${path}`);
  const body = new FormData();
  for (const [, attrs] of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    if (name) body.append(decode(name), decode(/value="([^"]*)"/.exec(attrs)?.[1] ?? ''));
  }
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(BASE + path, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
  return toPage(res);
}

function sessionCookie(page: Page): string {
  const header = page.setCookie.find((c) => c.startsWith(`${COOKIE}=`));
  assert.ok(header, 'session cookie set');
  return header.split(';')[0];
}

function redirectsTo(page: Page, path: string) {
  assert.ok([303, 307, 308].includes(page.status), `expected a redirect, got ${page.status}`);
  assert.equal(new URL(page.location!, BASE).pathname, path);
}

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
    const form = adminForm.html.split('<form').slice(1).find((f) => f.includes('Initial password'))!.split('</form>')[0];
    const body = new FormData();
    for (const [, attrs] of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
      const name = /name="([^"]*)"/.exec(attrs)?.[1];
      if (name) body.append(decode(name), decode(/value="([^"]*)"/.exec(attrs)?.[1] ?? ''));
    }
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
