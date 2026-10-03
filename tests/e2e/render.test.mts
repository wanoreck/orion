// Render test: every page, in a real client run (React hydration and effects), with no
// ServiceFlow connection (D4). Fails on any client-side error, so crashes that only happen
// in the browser are caught before a push.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDatabase, resetDatabase } from '../helpers.mts';
import { renderInBrowser } from './browser.mts';
import { PASSWORD, sessionCookie, setUpAdmin, startOrion, type Orion } from './harness.mts';

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
