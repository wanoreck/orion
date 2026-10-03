import { redirect } from 'next/navigation';
import { hasAnyUsers } from '@/auth/accounts';
import { getCurrentUser } from '@/auth/current';
import { LoginForm } from '@/components/auth-forms';

// Depends on the database (does any account exist yet?), so never prerendered at build.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Orion' };

export default async function LoginPage() {
  if (!(await hasAnyUsers())) redirect('/setup');
  if (await getCurrentUser()) redirect('/');
  return (
    <main className="orion-auth">
      <h1 className="cds--type-productive-heading-04">Sign in to Orion</h1>
      <LoginForm />
    </main>
  );
}
