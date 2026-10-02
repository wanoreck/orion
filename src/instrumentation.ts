// Next.js runs register() once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateOnStartup } = await import('./db/migrate');
  await migrateOnStartup();
}
