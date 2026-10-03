import 'server-only';
import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP's recommended minimum (19 MiB, 2 passes, 1 lane). These are also
// @node-rs/argon2's defaults; they're spelled out so a library upgrade can't change them.
const ARGON2_OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN = 12;
// Caps the work an attacker can force per login attempt.
export const PASSWORD_MAX = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash is a failed login, not a crash.
    return false;
  }
}

// Verified against when an email has no account, so "no such user" takes as long as
// "wrong password" and response times don't reveal which emails exist.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('orion-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}

/** Returns a problem with a proposed password, or null if it's acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}
