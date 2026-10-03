import { Content } from '@carbon/react';
import { redirect } from 'next/navigation';
import { hasAnyUsers } from '@/auth/accounts';
import { getCurrentUser } from '@/auth/current';
import { AppHeader } from '@/components/app-header';

// Everything in this group needs a signed-in account. Pages and Server Actions still
// check for themselves; this layout only provides the shell and the redirect.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect((await hasAnyUsers()) ? '/login' : '/setup');
  return (
    <>
      <AppHeader name={user.name} isAdmin={user.role === 'admin'} />
      <Content>{children}</Content>
    </>
  );
}
