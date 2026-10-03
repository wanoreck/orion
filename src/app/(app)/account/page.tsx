import { requireUser } from '@/auth/current';
import { ChangePasswordForm } from '@/components/auth-forms';

export const metadata = { title: 'Account · Orion' };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="orion-narrow">
      <h1 className="cds--type-productive-heading-04">Account</h1>
      <p>
        {user.name} · {user.email} · {user.role === 'admin' ? 'Admin' : 'User'}
      </p>
      <h2 className="cds--type-productive-heading-03 orion-section">Change password</h2>
      <ChangePasswordForm />
    </div>
  );
}
