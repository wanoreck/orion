import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { settings } from '@/db/schema';
import { decryptSecret, encryptSecret } from '@/crypto/secrets';
import { parseConnectionKey, type ConnectionKey } from './key';

// The one ServiceFlow connection this Orion instance uses (D3), kept in the settings table.
// The key itself is encrypted (purpose-bound); the rest is non-secret, for display.

const SETTING = 'serviceflow_connection';
const PURPOSE = 'serviceflow-connection-key';

type Stored = {
  encryptedKey: string;
  connectionId: string;
  site: string;
  savedAt: string;
  savedBy: string;
};

/** What's safe to show anyone, including the browser. Never contains the key. */
export type ConnectionSummary = { connectionId: string; site: string; savedAt: string };

async function readStored(): Promise<Stored | null> {
  const [row] = await db().select({ value: settings.value }).from(settings).where(eq(settings.key, SETTING));
  return (row?.value as Stored | undefined) ?? null;
}

export const getConnectionSummary = cache(async (): Promise<ConnectionSummary | null> => {
  const stored = await readStored();
  return stored ? { connectionId: stored.connectionId, site: stored.site, savedAt: stored.savedAt } : null;
});

/**
 * The decrypted key, or null when none is set. Throws if it can't be decrypted
 * (ORION_ENCRYPTION_KEY changed or missing): the Admin needs to paste the key again.
 */
export const getConnectionKey = cache(async (): Promise<ConnectionKey | null> => {
  const stored = await readStored();
  if (!stored) return null;
  const parsed = parseConnectionKey(decryptSecret(stored.encryptedKey, PURPOSE));
  if (!parsed.ok) throw new Error('The stored connection key is no longer valid');
  return parsed.key;
});

/** Replaces the connection. The caller has already verified the key against the site. */
export async function saveConnectionKey(raw: string, key: ConnectionKey, savedBy: string): Promise<void> {
  const value: Stored = {
    encryptedKey: encryptSecret(raw.trim(), PURPOSE),
    connectionId: key.id,
    site: key.site,
    savedAt: new Date().toISOString(),
    savedBy,
  };
  await db()
    .insert(settings)
    .values({ key: SETTING, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export type LoadedConnection =
  | { state: 'none' }
  /** Stored, but can't be decrypted (ORION_ENCRYPTION_KEY changed or missing). */
  | { state: 'unreadable'; summary: ConnectionSummary }
  | { state: 'ready'; summary: ConnectionSummary; key: ConnectionKey };

/** For pages: the connection and its key, or why there isn't a usable one. */
export async function loadConnection(): Promise<LoadedConnection> {
  const summary = await getConnectionSummary();
  if (!summary) return { state: 'none' };
  try {
    const key = await getConnectionKey();
    return key ? { state: 'ready', summary, key } : { state: 'none' };
  } catch {
    return { state: 'unreadable', summary };
  }
}
