// Shared by server and client components, so it must not live in a 'use client' module.

/** "Code: x · details", for the subtitle of an error notification. */
export function errorSubtitle(code?: string, detail?: string): string | undefined {
  const parts = [code && `Code: ${code}`, detail].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}
