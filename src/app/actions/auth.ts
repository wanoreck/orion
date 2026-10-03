'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticate,
  changePassword,
  createInitialAdmin,
  hasAnyUsers,
  normalizeEmail,
} from '@/auth/accounts';
import {
  clearSessionCookie,
  getSessionToken,
  requireUser,
  setSessionCookie,
} from '@/auth/current';
import { clearSignInFailures, isSignInBlocked, recordSignInFailure } from '@/auth/rate-limit';
import { createSession, deleteSession, deleteUserSessions } from '@/auth/session';
import type { FormState } from './form-state';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

// Orion sits behind Cloudflare and Traefik (D8); Cloudflare's header carries the real client.
async function clientAddress(): Promise<string> {
  const h = await headers();
  return (
    h.get('cf-connecting-ip') ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

async function startSession(userId: string): Promise<never> {
  await setSessionCookie(await createSession(userId));
  redirect('/');
}

/** First-run setup: creates the initial Admin and signs them in. */
export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (await hasAnyUsers()) redirect('/login');
  const values = { email: field(form, 'email'), name: field(form, 'name') };
  const password = field(form, 'password');
  if (password !== field(form, 'confirm')) return { error: "The passwords don't match.", values };
  const result = await createInitialAdmin({ ...values, password });
  if (!result.ok) return { error: result.error, values };
  return startSession(result.value.id);
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = normalizeEmail(field(form, 'email'));
  const values = { email };
  const client = await clientAddress();
  if (isSignInBlocked(email, client)) {
    return { error: 'Too many failed sign-in attempts. Wait a few minutes and try again.', values };
  }
  const user = await authenticate(email, field(form, 'password'));
  if (!user) {
    recordSignInFailure(email, client);
    return { error: 'Incorrect email or password, or the account is deactivated.', values };
  }
  clearSignInFailures(email);
  return startSession(user.id);
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) await deleteSession(token);
  await clearSessionCookie();
  redirect('/login');
}

/** Changes the signed-in user's own password and signs out their other sessions. */
export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const next = field(form, 'password');
  if (next !== field(form, 'confirm')) return { error: "The new passwords don't match." };
  const result = await changePassword(user.id, field(form, 'current'), next);
  if (!result.ok) return { error: result.error };
  await deleteUserSessions(user.id, await getSessionToken());
  return { success: 'Password changed. Your other sessions have been signed out.' };
}
