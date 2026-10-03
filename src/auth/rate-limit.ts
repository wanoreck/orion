import 'server-only';

// Failed sign-in throttling, in memory. Orion runs as a single process, so this is enough;
// a restart resets it.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_CLIENT = 30;

const failures = new Map<string, { count: number; resetAt: number }>();

function current(key: string, now: number): number {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) return 0;
  return entry.count;
}

function bump(key: string, now: number): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
  if (failures.size > 10_000) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
  }
}

export function isSignInBlocked(email: string, client: string, now = Date.now()): boolean {
  return (
    current(`email:${email}`, now) >= MAX_FAILURES_PER_EMAIL ||
    current(`client:${client}`, now) >= MAX_FAILURES_PER_CLIENT
  );
}

export function recordSignInFailure(email: string, client: string, now = Date.now()): void {
  bump(`email:${email}`, now);
  bump(`client:${client}`, now);
}

export function clearSignInFailures(email: string): void {
  failures.delete(`email:${email}`);
}
