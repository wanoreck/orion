import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { accountLinks, linkStates, type AccountLink } from '@/db/schema';
import { decryptSecret, encryptSecret } from '@/crypto/secrets';
import { getMe, type LinkCredential } from './api';
import { ApiError } from './client';
import type { ConnectionKey } from './key';
import type { Me } from './types';

// Account linking (D6, contract §3). The WordPress Application Password is stored only
// encrypted, bound to one Orion user and one connection, and never leaves the server.

const STATE_TTL_MS = 10 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Binds the ciphertext to its row, so a credential can't be moved to another account. */
function purpose(userId: string, connectionId: string): string {
  return `wp-application-password:${userId}:${connectionId}`;
}

/** Starts a link: a single-use token for the authorize redirect's success/reject URLs. */
export async function createLinkState(userId: string, connectionId: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db().delete(linkStates).where(lt(linkStates.expiresAt, now));
  await db()
    .insert(linkStates)
    .values({ id: hashToken(token), userId, connectionId, expiresAt: new Date(now.getTime() + STATE_TTL_MS) });
  return token;
}

export type StateCheck = 'ok' | 'unknown' | 'expired' | 'wrong_user' | 'wrong_connection';

/** Checks and uses up a link state. Any token presented is spent, valid or not. */
export async function consumeLinkState(
  token: string,
  userId: string,
  connectionId: string,
  now = new Date(),
): Promise<StateCheck> {
  if (!token) return 'unknown';
  const [row] = await db().delete(linkStates).where(eq(linkStates.id, hashToken(token))).returning();
  if (!row) return 'unknown';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (row.userId !== userId) return 'wrong_user';
  if (row.connectionId !== connectionId) return 'wrong_connection';
  return 'ok';
}

/** The link for this user on this connection (credential still encrypted), or null. */
export async function getLink(userId: string, connectionId: string): Promise<AccountLink | null> {
  const [row] = await db()
    .select()
    .from(accountLinks)
    .where(and(eq(accountLinks.userId, userId), eq(accountLinks.connectionId, connectionId)));
  return row ?? null;
}

/** Decrypts the stored credential, for signed linked requests only. Never send it anywhere else. */
export function decryptCredential(link: AccountLink): LinkCredential {
  const { user_login, password } = JSON.parse(decryptSecret(link.encryptedCredential, purpose(link.userId, link.connectionId)));
  return { username: user_login, password };
}

export async function saveLink(
  userId: string,
  connectionId: string,
  credential: LinkCredential,
  me: Me,
): Promise<void> {
  const encryptedCredential = encryptSecret(
    JSON.stringify({ user_login: credential.username, password: credential.password }),
    purpose(userId, connectionId),
  );
  const now = new Date();
  const values = {
    encryptedCredential,
    wpUserId: me.id,
    wpUsername: me.username,
    wpName: me.name,
    status: 'ok' as const,
    brokenCode: null,
    linkedAt: now,
    verifiedAt: now,
  };
  await db()
    .insert(accountLinks)
    .values({ userId, connectionId, ...values })
    .onConflictDoUpdate({ target: [accountLinks.userId, accountLinks.connectionId], set: values });
}

export async function deleteLink(userId: string, connectionId: string): Promise<boolean> {
  const rows = await db()
    .delete(accountLinks)
    .where(and(eq(accountLinks.userId, userId), eq(accountLinks.connectionId, connectionId)))
    .returning({ id: accountLinks.id });
  return rows.length > 0;
}

async function markLink(userId: string, connectionId: string, set: Partial<AccountLink>): Promise<void> {
  await db()
    .update(accountLinks)
    .set(set)
    .where(and(eq(accountLinks.userId, userId), eq(accountLinks.connectionId, connectionId)));
}

export type LinkCheck =
  | { state: 'none' }
  | { state: 'ok'; link: AccountLink; me: Me }
  /** The site rejected the credential: relink needed. */
  | { state: 'broken'; link: AccountLink; code: string }
  /** Couldn't check (site unreachable etc.); the stored status is unchanged. */
  | { state: 'unknown'; link: AccountLink; error: ApiError };

/**
 * Checks a user's link live with a signed GET /me. A link-type rejection (401 from a
 * revoked or deleted Application Password, sf_api_link_mismatch, …) marks it broken.
 */
export async function checkLink(userId: string, key: ConnectionKey): Promise<LinkCheck> {
  const link = await getLink(userId, key.id);
  if (!link) return { state: 'none' };
  let credential: LinkCredential;
  try {
    credential = decryptCredential(link);
  } catch {
    // ORION_ENCRYPTION_KEY changed: the credential is unusable, so the account must relink.
    await markLink(userId, key.id, { status: 'broken', brokenCode: 'orion_credential_unreadable' });
    return { state: 'broken', link: { ...link, status: 'broken' }, code: 'orion_credential_unreadable' };
  }
  try {
    const { data: me } = await getMe(key, credential);
    await markLink(userId, key.id, {
      status: 'ok', brokenCode: null, verifiedAt: new Date(), wpUserId: me.id, wpUsername: me.username, wpName: me.name,
    });
    return { state: 'ok', link: { ...link, status: 'ok', wpName: me.name, wpUsername: me.username }, me };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.kind === 'link' || err.status === 401) {
      await markLink(userId, key.id, { status: 'broken', brokenCode: err.code });
      return { state: 'broken', link: { ...link, status: 'broken' }, code: err.code };
    }
    return { state: 'unknown', link, error: err };
  }
}
