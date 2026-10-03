'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/auth/current';
import { EncryptionKeyError, encryptSecret } from '@/crypto/secrets';
import { getConnection } from '@/serviceflow/api';
import { ApiError } from '@/serviceflow/client';
import { saveConnectionKey } from '@/serviceflow/connection';
import { parseConnectionKey } from '@/serviceflow/key';
import type { FormState } from './form-state';

/**
 * Admin only (D6): sets or replaces the ServiceFlow connection key. The key is verified
 * with a signed GET /connection before it's stored, so a wrong key never replaces a working
 * one. Nothing typed is echoed back: the key must not round-trip to the browser.
 */
export async function saveConnectionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const raw = form.get('key');
  const parsed = parseConnectionKey(typeof raw === 'string' ? raw : '');
  if (!parsed.ok) return { error: parsed.error, code: 'orion_key_format' };

  try {
    encryptSecret('check', 'probe'); // Fail before contacting the site if encryption isn't configured.
  } catch (err) {
    if (err instanceof EncryptionKeyError) {
      return { error: `Orion can't store secrets: ${err.message} Set it in Coolify and redeploy.`, code: 'orion_encryption_key' };
    }
    throw err;
  }

  let siteName: string;
  try {
    const { data } = await getConnection(parsed.key);
    if (data?.connection?.id !== parsed.key.id) {
      return {
        error: 'The site answered for a different connection than this key. Create a new key in ServiceFlow and try again.',
        code: 'orion_connection_mismatch',
      };
    }
    siteName = data.site?.name ?? parsed.key.site;
  } catch (err) {
    if (err instanceof ApiError) {
      return { error: `Verification failed, so the key was not saved. ${err.explanation}`, code: err.code };
    }
    throw err;
  }

  await saveConnectionKey(String(raw), parsed.key, admin.email);
  revalidatePath('/', 'layout');
  return { success: `Connected to ${siteName}.` };
}
