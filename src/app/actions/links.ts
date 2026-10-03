'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/auth/current';
import { publicOrigin } from '@/lib/public-url';
import { getConnection } from '@/serviceflow/api';
import { ApiError } from '@/serviceflow/client';
import { loadConnection } from '@/serviceflow/connection';
import { createLinkState, deleteLink } from '@/serviceflow/links';
import type { FormState } from './form-state';

const LINK_CALLBACK_PATH = '/account/link/callback';

/**
 * Starts linking the signed-in account (contract §3): sends the browser to WordPress's
 * "Authorize Application" page, which returns to the callback with the new credential.
 */
export async function startLinkAction(_prev: FormState): Promise<FormState> {
  const user = await requireUser();
  const connection = await loadConnection();
  if (connection.state !== 'ready') {
    return { error: 'Orion needs a working ServiceFlow connection before accounts can be linked.', code: 'orion_no_connection' };
  }

  let linking;
  try {
    linking = (await getConnection(connection.key)).data.linking;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { error: `Couldn't start linking. ${err.explanation}`, code: err.code, detail: user.role === 'admin' ? err.detail : undefined };
  }
  if (!linking?.available) {
    return {
      error: "The ServiceFlow site doesn't offer account linking. WordPress only allows it over HTTPS.",
      code: 'orion_linking_unavailable',
    };
  }

  const origin = await publicOrigin();
  if (!origin) {
    return {
      error: "Orion isn't being served over HTTPS, and WordPress only sends people back to https:// addresses.",
      code: 'orion_not_https',
      detail: user.role === 'admin' ? 'Serve Orion over HTTPS, or set ORION_PUBLIC_URL to its https:// address.' : undefined,
    };
  }

  const token = await createLinkState(user.id, connection.key.id);
  const back = `${origin}${LINK_CALLBACK_PATH}?state=${encodeURIComponent(token)}`;
  const authorize = new URL(linking.authorize_url);
  authorize.searchParams.set('app_name', linking.app_name);
  authorize.searchParams.set('app_id', linking.app_id);
  authorize.searchParams.set('success_url', back);
  authorize.searchParams.set('reject_url', back);
  redirect(authorize.toString());
}

/** Removes this account's stored credential for the current connection. */
export async function unlinkAction(_prev: FormState): Promise<FormState> {
  const user = await requireUser();
  const connection = await loadConnection();
  if (connection.state !== 'ready') return { error: 'There is no working ServiceFlow connection.', code: 'orion_no_connection' };
  await deleteLink(user.id, connection.key.id);
  revalidatePath('/', 'layout');
  return {
    success:
      'Unlinked. Orion no longer has your Application Password. It still exists in WordPress until you delete it there (Users → Profile → Application Passwords).',
  };
}
