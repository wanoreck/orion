import { Content, InlineNotification } from '@carbon/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasAnyUsers } from '@/auth/accounts';
import { getCurrentUser } from '@/auth/current';
import { AppHeader } from '@/components/app-header';
import { getConnectionSummary } from '@/serviceflow/connection';
import { getLink } from '@/serviceflow/links';

// Everything in this group needs a signed-in account. Pages and Server Actions still
// check for themselves; this layout only provides the shell and the redirect.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect((await hasAnyUsers()) ? '/login' : '/setup');
  const isAdmin = user.role === 'admin';
  const summary = await getConnectionSummary();
  const connected = Boolean(summary);
  // From the stored status only; the Account page re-checks it live (GET /me).
  const link = summary ? await getLink(user.id, summary.connectionId) : null;
  return (
    <>
      <AppHeader name={user.name} isAdmin={isAdmin} />
      <Content>
        {!connected && (
          // D4: with no connection, Orion is empty, not broken. Carbon's InlineNotification
          // throws on interactive children, so the Settings link sits below it.
          <div className="orion-notice">
            <InlineNotification kind="info" lowContrast hideCloseButton
              title="Orion isn't connected to a ServiceFlow site yet, so there's no data to show."
              subtitle={isAdmin ? "Add the site's connection key in Settings." : 'Ask an Admin to add the connection key in Settings.'} />
            {isAdmin && (
              <p className="orion-notice-action">
                <Link href="/settings">Go to Settings</Link>
              </p>
            )}
          </div>
        )}
        {connected && link?.status !== 'ok' && (
          // D6/D7: unlinked (or broken) accounts are read-only, and are told so.
          <div className="orion-notice">
            <InlineNotification kind="warning" lowContrast hideCloseButton
              title={link ? 'Your WordPress link stopped working: read-only' : 'Not linked: read-only'}
              subtitle="You can view data, but not make changes, until your account is linked to your WordPress user." />
            <p className="orion-notice-action">
              <Link href="/account">{link ? 'Link again on your Account page' : 'Link your WordPress account'}</Link>
            </p>
          </div>
        )}
        {children}
      </Content>
    </>
  );
}
