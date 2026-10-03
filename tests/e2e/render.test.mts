// Render test: every page, in a real client run (React hydration and effects), with no
// ServiceFlow connection (D4). Fails on any client-side error, so crashes that only happen
// in the browser are caught before a push.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, resetDatabase } from '../helpers.mts';
import { renderInBrowser } from './browser.mts';
import { startFakeServiceFlow } from '../fake-serviceflow.mts';
import { ENCRYPTION_KEY, PASSWORD, sessionCookie, setUpAdmin, startOrion, type Orion } from './harness.mts';

let orion: Orion;

before(async () => {
  await resetDatabase();
  orion = await startOrion(3997);
});

after(async () => {
  orion?.stop();
  await closeDatabase();
});

async function expectClean(path: string, cookie: string | undefined, landsOn: string, shows: RegExp) {
  const page = await renderInBrowser(orion.base, path, cookie);
  assert.equal(page.status, 200, `${path} → ${page.url}`);
  assert.equal(page.url, landsOn);
  assert.deepEqual(page.errors, [], `client errors on ${path}`);
  assert.match(page.text, shows, `${path} rendered its content`);
  // Next's error screen, should a client crash slip past the error hooks.
  assert.doesNotMatch(page.text, /Application error|couldn.t load/i);
}

test('the favicon is served', async () => {
  const res = await fetch(`${orion.base}/favicon.ico`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image/);
  const page = await orion.get('/login');
  assert.match(page.html, /rel="icon"/);
});

test('every page renders without client errors, with no connection', async (t) => {
  await t.test('before setup', async () => {
    await expectClean('/', undefined, '/setup', /Set up Orion/);
    await expectClean('/setup', undefined, '/setup', /Create Admin account/);
  });

  const admin = await setUpAdmin(orion);
  await orion.submit('/users', 'Initial password', { name: 'Uma User', email: 'uma@example.com', role: 'user', password: PASSWORD }, admin);
  const user = sessionCookie(await orion.submit('/login', 'current-password', { email: 'uma@example.com', password: PASSWORD }));

  await t.test('signed out', async () => {
    await expectClean('/login', undefined, '/login', /Sign in to Orion/);
    await expectClean('/users', undefined, '/login', /Sign in to Orion/);
  });

  for (const [who, cookie, pages] of [
    ['Admin', admin, [['/', /isn.t connected/], ['/users', /Create an account/], ['/settings', /No connection key is set/], ['/account', /Change password/]]],
    ['User', user, [['/', /Ask an Admin/], ['/account', /Change password/]]],
  ] as const) {
    for (const [path, shows] of pages) {
      await t.test(`${who}: ${path}`, () => expectClean(path, cookie, path, shows));
    }
  }
});

test('pages render without client errors once connected, linked or not', async (t) => {
  const site = await startFakeServiceFlow();
  site.linkingAvailable = true;
  try {
    const { sql } = await import('@/db');
    await sql()`truncate users, sessions, settings, account_links, link_states cascade`;
    const admin = await setUpAdmin(orion, 'linker@example.com');
    await orion.submit('/settings', 'name="key"', { key: site.key }, admin);

    await t.test('unlinked', async () => {
      await expectClean('/', admin, '/', /Not linked: read-only/);
      await expectClean('/account', admin, '/account', /Link WordPress account/);
      await expectClean('/settings', admin, '/settings', /Fake ServiceFlow/);
    });

    // Store a link the way the callback would (same encryption key as the server).
    process.env.ORION_ENCRYPTION_KEY = ENCRYPTION_KEY;
    const links = await import('@/serviceflow/links');
    const [{ id }] = await sql()`select id from users where email = 'linker@example.com'`;
    const credential = { username: 'ada', password: site.approve('ada') };
    await links.saveLink(id, site.connectionId, credential, {
      id: 7, public_id: 'USR-7', username: 'ada', name: 'WP ada', first_name: '', last_name: '', email: '',
      avatar_url: '', roles: [], link: { name: 'Orion (test)', created_at: '' },
    });

    await t.test('linked', async () => {
      await expectClean('/', admin, '/', /Welcome/);
      await expectClean('/account', admin, '/account', /Unlink WordPress account/);
    });

    await t.test('link broken', async () => {
      site.appPasswords.get('ada')!.revoked = true;
      await expectClean('/account', admin, '/account', /stopped working/);
    });
  } finally {
    await site.close();
  }
});
