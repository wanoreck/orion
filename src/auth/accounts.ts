import 'server-only';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { users, type Role, type User } from '@/db/schema';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from './password';
import type { SessionUser } from './session';

// Serializes account changes that must see a consistent view of the users table
// (first-run setup, keeping at least one active admin). Arbitrary app-wide constant.
const ACCOUNTS_LOCK = 0x0_7210_0001;

export type AccountInput = { email: string; name: string; password: string; role: Role };
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Checks new-account fields; returns the first problem, or null. */
export function accountInputProblem(input: AccountInput): string | null {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return 'Enter a valid email address.';
  }
  const name = input.name.trim();
  if (!name) return 'Enter a name.';
  if (name.length > 100) return 'Use a name of at most 100 characters.';
  return passwordProblem(input.password);
}

export async function hasAnyUsers(): Promise<boolean> {
  const [row] = await db().select({ n: count() }).from(users);
  return row.n > 0;
}

function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  return (err as { code?: string })?.code === '23505' || cause?.code === '23505';
}

async function insertUser(
  tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0],
  input: AccountInput,
  passwordHash: string,
): Promise<SessionUser> {
  const [created] = await tx
    .insert(users)
    .values({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash,
      role: input.role,
    })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
  return created;
}

/**
 * Creates the first account, always an Admin. Refused once any account exists, even if
 * two setup requests race each other.
 */
export async function createInitialAdmin(
  input: Omit<AccountInput, 'role'>,
): Promise<Result<SessionUser>> {
  const full = { ...input, role: 'admin' as const };
  const problem = accountInputProblem(full);
  if (problem) return { ok: false, error: problem };
  const passwordHash = await hashPassword(input.password);
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNTS_LOCK})`);
    const [row] = await tx.select({ n: count() }).from(users);
    if (row.n > 0) return { ok: false, error: 'Orion has already been set up. Sign in instead.' };
    return { ok: true, value: await insertUser(tx, full, passwordHash) };
  });
}

export async function createUser(input: AccountInput): Promise<Result<SessionUser>> {
  const problem = accountInputProblem(input);
  if (problem) return { ok: false, error: problem };
  const passwordHash = await hashPassword(input.password);
  try {
    return { ok: true, value: await db().transaction((tx) => insertUser(tx, input, passwordHash)) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'An account with that email already exists.' };
    throw err;
  }
}

/**
 * Checks an email and password. Unknown emails, wrong passwords and deactivated accounts
 * all get the same answer, in about the same time.
 */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  if (!password || password.length > 256) return null;
  const [user] = await db().select().from(users).where(eq(users.email, normalizeEmail(email)));
  if (!user) {
    await burnPasswordCheck(password);
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, password)) || !user.active) return null;
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export type UserListItem = Omit<User, 'passwordHash'>;

export async function listUsers(): Promise<UserListItem[]> {
  return db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.name), asc(users.email));
}

/**
 * Activates or deactivates an account. Admins can't deactivate themselves, and the last
 * active Admin can't be deactivated, so Orion always keeps someone who can manage it.
 * Deactivated accounts' sessions stop working immediately (validateSessionToken checks).
 */
export async function setUserActive(
  actorId: string,
  userId: string,
  active: boolean,
): Promise<Result> {
  if (!active && actorId === userId) return { ok: false, error: "You can't deactivate your own account." };
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNTS_LOCK})`);
    const [target] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (!target) return { ok: false, error: 'That account no longer exists.' };
    if (!active && target.role === 'admin') {
      const [others] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, userId)));
      if (others.n === 0) return { ok: false, error: "The last active Admin can't be deactivated." };
    }
    await tx.update(users).set({ active, updatedAt: new Date() }).where(eq(users.id, userId));
    return { ok: true, value: undefined };
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<Result> {
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, error: 'Your current password is incorrect.' };
  }
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  await db()
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
  return { ok: true, value: undefined };
}
