import { getCurrentUser } from '@/auth/current';
import { getMe } from '@/serviceflow/api';
import { ApiError } from '@/serviceflow/client';
import { loadConnection } from '@/serviceflow/connection';
import { consumeLinkState, saveLink } from '@/serviceflow/links';

export const dynamic = 'force-dynamic';

// WordPress's "Authorize Application" page sends the browser here (contract §3) with
// site_url, user_login and password in the query string, or success=false. The password
// is only ever in this one request: it's verified, encrypted and stored, then the browser
// is sent straight on so it leaves the address bar. Nothing here logs the URL.

function back(query: Record<string, string>): Response {
  return new Response(null, {
    status: 303,
    headers: {
      // Relative, so it's right behind any proxy.
      Location: `/account?${new URLSearchParams(query)}`,
      // Keep the password-bearing URL out of Referer headers and caches.
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
  });
}

function sameSite(a: string, b: string): boolean {
  const norm = (u: string) => {
    const url = new URL(u);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const user = await getCurrentUser();
  if (!user) {
    return new Response(null, { status: 303, headers: { Location: '/login', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } });
  }
  const connection = await loadConnection();
  if (connection.state !== 'ready') return back({ link_error: 'orion_no_connection' });
  const key = connection.key;

  // The state must be one this user started, for this connection, in the last 10 minutes.
  const state = await consumeLinkState(params.get('state') ?? '', user.id, key.id);
  if (state !== 'ok') return back({ link_error: `orion_link_state_${state}` });

  if (params.get('success') === 'false') return back({ link_error: 'orion_link_rejected' });

  const username = params.get('user_login') ?? '';
  const password = params.get('password') ?? '';
  const siteUrl = params.get('site_url') ?? '';
  if (!username || !password || !siteUrl) return back({ link_error: 'orion_link_incomplete' });
  if (!sameSite(siteUrl, key.site)) return back({ link_error: 'orion_link_wrong_site' });

  const credential = { username, password };
  let me;
  try {
    me = (await getMe(key, credential)).data;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return back({ link_error: err.code });
  }
  if (me.username.toLowerCase() !== username.toLowerCase()) return back({ link_error: 'orion_link_user_mismatch' });

  await saveLink(user.id, key.id, credential, me);
  return back({ linked: '1' });
}
