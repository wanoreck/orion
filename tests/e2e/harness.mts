// Runs the production build (.next/standalone, so `npm run build` first) and drives it over
// HTTP the way a browser does with JavaScript off: fetch a page, then post its form
// (Server Actions accept plain form posts).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';

export const COOKIE = '__Host-orion_session';
export const PASSWORD = 'correct horse battery';
export const ENCRYPTION_KEY = Buffer.alloc(32, 42).toString('base64');

export type Page = { status: number; location: string | null; html: string; setCookie: string[] };

export type Orion = {
  base: string;
  get(path: string, cookie?: string): Promise<Page>;
  /** Posts the form on `path` that contains `marker`, with its hidden fields plus `fields`. */
  submit(path: string, marker: string, fields: Record<string, string>, cookie?: string, origin?: string): Promise<Page>;
  stop(): void;
};

async function toPage(res: Response): Promise<Page> {
  // React separates adjacent text and values with <!-- --> markers; drop them for matching.
  const html = (await res.text()).replaceAll('<!-- -->', '');
  return { status: res.status, location: res.headers.get('location'), html, setCookie: res.headers.getSetCookie() };
}

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The hidden inputs of the form on the page that contains `marker`. */
export function hiddenFields(html: string, marker: string): FormData {
  const form = html.split('<form').slice(1).map((f) => f.split('</form>')[0]).find((f) => f.includes(marker));
  assert.ok(form, `no form containing ${marker}`);
  const body = new FormData();
  for (const [, attrs] of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    if (name) body.append(decode(name), decode(/value="([^"]*)"/.exec(attrs)?.[1] ?? ''));
  }
  return body;
}

export async function startOrion(port: number, env: Record<string, string> = {}): Promise<Orion> {
  if (!existsSync('.next/standalone/server.js')) throw new Error('Run `npm run build` first');
  // Lay the build out as the Dockerfile does: static assets beside the standalone server.
  rmSync('.next/standalone/.next/static', { recursive: true, force: true });
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  const server: ChildProcess = spawn('node', ['.next/standalone/server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      ORION_ENCRYPTION_KEY: ENCRYPTION_KEY,
      ...env,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const orion: Orion = {
    base,
    async get(path, cookie) {
      return toPage(await fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} }));
    },
    async submit(path, marker, fields, cookie, origin = base) {
      const page = await orion.get(path, cookie);
      assert.equal(page.status, 200, `GET ${path}`);
      const body = hiddenFields(page.html, marker);
      for (const [k, v] of Object.entries(fields)) body.append(k, v);
      return toPage(await fetch(base + path, {
        method: 'POST',
        body,
        redirect: 'manual',
        headers: { origin, ...(cookie ? { cookie } : {}) },
      }));
    },
    stop: () => server.kill(),
  };

  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return orion;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  server.kill();
  throw new Error('Orion did not start');
}

export function sessionCookie(page: Page): string {
  const header = page.setCookie.find((c) => c.startsWith(`${COOKIE}=`));
  assert.ok(header, 'session cookie set');
  return header.split(';')[0];
}

export function redirectsTo(page: Page, path: string) {
  assert.ok([303, 307, 308].includes(page.status), `expected a redirect, got ${page.status}`);
  assert.equal(new URL(page.location!, 'http://x').pathname, path);
}

/** Runs first-run setup and returns the Admin's session cookie. */
export async function setUpAdmin(orion: Orion, email = 'ada@example.com'): Promise<string> {
  const page = await orion.submit('/setup', 'name="confirm"', {
    name: 'Ada Admin', email, password: PASSWORD, confirm: PASSWORD,
  });
  redirectsTo(page, '/');
  return sessionCookie(page);
}
