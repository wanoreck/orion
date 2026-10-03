import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt, ne } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users, type User } from '@/db/schema';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A session ends after this long without use… */
export const SESSION_IDLE_MS = 7 * DAY;
/** …and after this long regardless, so a stolen cookie can't live forever. */
export const SESSION_MAX_MS = 30 * DAY;
// Push the idle expiry forward at most once an hour, not on every request.
const RENEW_GRANULARITY_MS = HOUR;

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role'>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(userId: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    });
  // Opportunistic cleanup; the table stays small, so this is cheap.
  await db().delete(sessions).where(lt(sessions.expiresAt, now));
  return token;
}

/**
 * Returns the signed-in user for a cookie token, or null if the session is unknown,
 * expired, or belongs to a deactivated account. Extends the idle expiry while in use.
 */
export async function validateSessionToken(
  token: string,
  now = new Date(),
): Promise<SessionUser | null> {
  const id = hashToken(token);
  const [row] = await db()
    .select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      user: { id: users.id, email: users.email, name: users.name, role: users.role },
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  if (!row) return null;

  const hardLimit = row.createdAt.getTime() + SESSION_MAX_MS;
  if (!row.active || row.expiresAt.getTime() <= now.getTime() || hardLimit <= now.getTime()) {
    await db().delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  const renewed = Math.min(now.getTime() + SESSION_IDLE_MS, hardLimit);
  if (renewed - row.expiresAt.getTime() >= RENEW_GRANULARITY_MS) {
    await db().update(sessions).set({ expiresAt: new Date(renewed) }).where(eq(sessions.id, id));
  }
  return row.user;
}

export async function deleteSession(token: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Signs a user out everywhere, optionally keeping the session making the request. */
export async function deleteUserSessions(userId: string, exceptToken?: string): Promise<void> {
  await db()
    .delete(sessions)
    .where(
      exceptToken
        ? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(exceptToken)))
        : eq(sessions.userId, userId),
    );
}
