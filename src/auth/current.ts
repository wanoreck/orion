import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_MAX_MS, validateSessionToken, type SessionUser } from './session';

// __Host- makes the browser insist on Secure, path=/ and no Domain, so no other subdomain
// can set or overwrite it. Browsers refuse Secure cookies over plain http, so local
// development (http://localhost) uses an unprefixed name instead.
const secure = process.env.NODE_ENV === 'production';
const COOKIE = secure ? '__Host-orion_session' : 'orion_session';

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

/** Only callable from Server Actions and Route Handlers (Next.js forbids it in pages). */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user for this request, or null. Looked up once per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await getSessionToken();
  return token ? validateSessionToken(token) : null;
});

/** For pages and actions that need a signed-in user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** For Admin-only pages and actions (D6). Signed-in Users are sent home. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/');
  return user;
}
