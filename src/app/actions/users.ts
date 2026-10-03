'use server';

import { revalidatePath } from 'next/cache';
import { createUser, setUserActive } from '@/auth/accounts';
import { requireAdmin } from '@/auth/current';
import { deleteUserSessions } from '@/auth/session';
import { ROLES, type Role } from '@/db/schema';
import type { FormState } from './form-state';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** Admin only (D6): creates an account with a password the Admin passes on. */
export async function createUserAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const role = field(form, 'role');
  const values = { email: field(form, 'email'), name: field(form, 'name'), role };
  if (!ROLES.includes(role as Role)) return { error: 'Choose a role.', values };
  const result = await createUser({ ...values, role: role as Role, password: field(form, 'password') });
  if (!result.ok) return { error: result.error, values };
  revalidatePath('/users');
  return { success: `Created ${result.value.email}.` };
}

/** Admin only (D6): deactivates or reactivates an account. */
export async function setUserActiveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = field(form, 'userId');
  const active = field(form, 'active') === 'true';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return { error: 'That account no longer exists.' };
  }
  const result = await setUserActive(admin.id, userId, active);
  if (!result.ok) return { error: result.error };
  if (!active) await deleteUserSessions(userId);
  revalidatePath('/users');
  return { success: active ? 'Account reactivated.' : 'Account deactivated and signed out.' };
}
