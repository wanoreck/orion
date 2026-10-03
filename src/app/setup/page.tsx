import { redirect } from 'next/navigation';
import { hasAnyUsers } from '@/auth/accounts';
import { SetupForm } from '@/components/auth-forms';

// Depends on the database (does any account exist yet?), so never prerendered at build.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up Orion' };

// First run only: once any account exists, setup is closed (D6).
export default async function SetupPage() {
  if (await hasAnyUsers()) redirect('/login');
  return (
    <main className="orion-auth">
      <h1 className="cds--type-productive-heading-04">Set up Orion</h1>
      <p className="orion-auth-intro">
        Create the first Admin account. Admins manage Orion&apos;s users and settings, including the
        ServiceFlow connection.
      </p>
      <SetupForm />
    </main>
  );
}
