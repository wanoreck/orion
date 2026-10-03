import { requireUser } from '@/auth/current';

// Placeholder home. Real screens wait for the user's UI references (D17).
export default async function Home() {
  const user = await requireUser();
  return (
    <>
      <h1 className="cds--type-productive-heading-04">Welcome, {user.name}</h1>
      <p>
        You&apos;re signed in as {user.role === 'admin' ? 'an Admin' : 'a User'}. Connecting to
        ServiceFlow comes next.
      </p>
    </>
  );
}
