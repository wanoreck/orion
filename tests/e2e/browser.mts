// A minimal browser for render tests: loads a page from the running production build in
// jsdom, runs Next.js's client scripts so React hydrates and runs effects, and collects
// every uncaught error and console.error. Catches client-only crashes (like a Carbon
// component throwing in an effect) that the server-rendered HTML never shows.
import { JSDOM, VirtualConsole } from 'jsdom';

export type Rendered = { url: string; status: number; errors: string[]; text: string };

const HYDRATION_WAIT_MS = 1500;

export async function renderInBrowser(base: string, path: string, cookie?: string): Promise<Rendered> {
  // Follow redirects ourselves so the session cookie goes along.
  let url = new URL(path, base);
  let res: Response;
  for (let hops = 0; ; hops++) {
    res = await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    const location = res.headers.get('location');
    if (!location || hops > 5) break;
    url = new URL(location, url);
  }
  const html = await res.text();

  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args: unknown[]) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('jsdomError', (err: Error) => {
    // jsdom's own gaps (unimplemented layout APIs) aren't Orion's errors.
    if (/Not implemented/.test(err.message)) return;
    errors.push(`${err.message}${(err as { detail?: unknown }).detail ? `: ${String((err as { detail?: unknown }).detail)}` : ''}`);
  });

  // Rejections inside jsdom's scripts can surface on Node's process instead of the window.
  const onRejection = (reason: unknown) =>
    errors.push(`Unhandled rejection: ${(reason as Error)?.message ?? String(reason)}`);
  process.on('unhandledRejection', onRejection);

  const dom = new JSDOM(html, {
    url: url.toString(),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>;
      // Browser APIs Next.js and Carbon expect that jsdom lacks.
      w.fetch = (input: string | URL | Request, init: RequestInit = {}) => {
        const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, url);
        const headers = new Headers(init.headers);
        if (cookie && target.origin === url.origin) headers.set('cookie', cookie);
        return fetch(target, { ...init, headers });
      };
      w.Headers = Headers;
      w.Request = Request;
      w.Response = Response;
      w.ReadableStream = ReadableStream;
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
      w.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
      w.IntersectionObserver ??= NoopObserver;
      w.ResizeObserver ??= NoopObserver;
      w.requestIdleCallback ??= (cb: () => void) => setTimeout(cb, 1);
      w.cancelIdleCallback ??= (id: number) => clearTimeout(id);
      // Browsers set document.currentScript while a chunk evaluates; jsdom loses it when
      // Turbopack evaluates chunks asynchronously. Next.js reads it to find /_next/.
      const realCurrentScript = Object.getOwnPropertyDescriptor(window.Document.prototype, 'currentScript')!.get!;
      Object.defineProperty(window.document, 'currentScript', {
        get() {
          return realCurrentScript.call(this) ?? this.querySelector('script[src*="/_next/"]');
        },
      });
      window.addEventListener('error', (event) => errors.push(`Uncaught: ${event.error?.message ?? event.message}`));
      window.addEventListener('unhandledrejection', (event) =>
        errors.push(`Unhandled rejection: ${(event as PromiseRejectionEvent).reason?.message ?? String((event as PromiseRejectionEvent).reason)}`));
    },
  });

  await new Promise<void>((resolve) => {
    if (dom.window.document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', () => resolve());
  });
  await new Promise((r) => setTimeout(r, HYDRATION_WAIT_MS));
  const text = dom.window.document.body?.textContent ?? '';
  dom.window.close();
  process.off('unhandledRejection', onRejection);
  return { url: url.pathname, status: res.status, errors, text };
}
