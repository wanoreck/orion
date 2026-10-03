import { InlineNotification, StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper } from '@carbon/react';
import { requireUser } from '@/auth/current';
import { ChangePasswordForm } from '@/components/auth-forms';
import { errorSubtitle } from '@/components/error-subtitle';
import { LinkButton, UnlinkButton } from '@/components/link-forms';
import { getConnection } from '@/serviceflow/api';
import { ApiError, explainCode } from '@/serviceflow/client';
import { loadConnection } from '@/serviceflow/connection';
import { checkLink, type LinkCheck } from '@/serviceflow/links';

export const metadata = { title: 'Account · Orion' };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <StructuredListRow>
      <StructuredListCell noWrap>{label}</StructuredListCell>
      <StructuredListCell>{children}</StructuredListCell>
    </StructuredListRow>
  );
}

const READ_ONLY = 'You can view data, but not make changes, until your account is linked to your WordPress user.';

/** The WordPress link section: checks the link live (GET /me) on every visit (D6, D7). */
async function WordPressLink({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const connection = await loadConnection();
  if (connection.state !== 'ready') {
    return <p>Linking needs a working ServiceFlow connection{isAdmin ? ' (Settings)' : ''}.</p>;
  }
  const check: LinkCheck = await checkLink(userId, connection.key);

  // Whether linking can be started (only asked when it's needed).
  let linkingProblem: { message: string; code: string; detail?: string } | null = null;
  if (check.state === 'none' || check.state === 'broken') {
    try {
      const { linking } = (await getConnection(connection.key)).data;
      if (!linking.available) {
        linkingProblem = {
          message: "The ServiceFlow site doesn't offer account linking: WordPress only allows it over HTTPS.",
          code: 'orion_linking_unavailable',
        };
      }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      linkingProblem = { message: err.explanation, code: err.code, detail: isAdmin ? err.detail : undefined };
    }
  }
  const linkAction = linkingProblem ? (
    <InlineNotification kind="error" lowContrast hideCloseButton title={`Linking isn't possible right now. ${linkingProblem.message}`}
      subtitle={errorSubtitle(linkingProblem.code, linkingProblem.detail)} />
  ) : null;

  switch (check.state) {
    case 'none':
      return (
        <>
          <InlineNotification kind="warning" lowContrast hideCloseButton title="Not linked: read-only" subtitle={READ_ONLY} />
          <p className="orion-section">
            Linking sends you to the ServiceFlow site to approve access. Orion then acts as your WordPress user, so
            the activity log shows your name.
          </p>
          {linkAction ?? <LinkButton label="Link WordPress account" />}
        </>
      );
    case 'broken':
      return (
        <>
          <InlineNotification kind="error" lowContrast hideCloseButton
            title={`Your WordPress link stopped working, so you're read-only. ${explainCode(check.code)}`}
            subtitle={errorSubtitle(check.code)} />
          <p className="orion-section">Previously linked as {check.link.wpName} ({check.link.wpUsername}). Link again to fix it.</p>
          <div className="orion-button-row">
            {linkAction ?? <LinkButton label="Link again" />}
            <UnlinkButton />
          </div>
        </>
      );
    case 'unknown':
      return (
        <>
          <InlineNotification kind="warning" lowContrast hideCloseButton
            title={`Couldn't check your WordPress link. ${check.error.explanation}`}
            subtitle={errorSubtitle(check.error.code, isAdmin ? check.error.detail : undefined)} />
          <p className="orion-section">Linked as {check.link.wpName} ({check.link.wpUsername}).</p>
          <UnlinkButton />
        </>
      );
    case 'ok':
      return (
        <>
          <StructuredListWrapper aria-label="WordPress link" isCondensed>
            <StructuredListBody>
              <Detail label="Status">Linked</Detail>
              <Detail label="WordPress user">{check.me.name} ({check.me.username})</Detail>
              <Detail label="Application Password">{check.me.link.name}</Detail>
              <Detail label="Linked">{check.link.linkedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</Detail>
            </StructuredListBody>
          </StructuredListWrapper>
          <UnlinkButton />
        </>
      );
  }
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  // Results of the link callback. Only well-formed codes are shown.
  const linkError = typeof params.link_error === 'string' && /^[a-z0-9_]{1,64}$/.test(params.link_error) ? params.link_error : null;
  const linked = params.linked === '1';

  return (
    <div className="orion-narrow">
      <h1 className="cds--type-productive-heading-04">Account</h1>
      <p>
        {user.name} · {user.email} · {user.role === 'admin' ? 'Admin' : 'User'}
      </p>

      <h2 className="cds--type-productive-heading-03 orion-section">WordPress account</h2>
      {linked && <InlineNotification kind="success" lowContrast hideCloseButton title="Your WordPress account is linked." className="orion-notice" />}
      {linkError && (
        <InlineNotification kind="error" lowContrast hideCloseButton className="orion-notice"
          title={`Linking didn't complete. ${explainCode(linkError)}`} subtitle={errorSubtitle(linkError)} />
      )}
      <WordPressLink userId={user.id} isAdmin={user.role === 'admin'} />

      <h2 className="cds--type-productive-heading-03 orion-section">Change password</h2>
      <ChangePasswordForm />
    </div>
  );
}
