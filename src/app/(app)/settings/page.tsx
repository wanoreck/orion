import { InlineNotification, StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper } from '@carbon/react';
import { requireAdmin } from '@/auth/current';
import { errorSubtitle } from '@/components/error-subtitle';
import { ConnectionKeyForm } from '@/components/connection-form';
import { getConnection } from '@/serviceflow/api';
import { ApiError, CONTRACT_API_VERSION } from '@/serviceflow/client';
import { loadConnection } from '@/serviceflow/connection';
import type { Connection } from '@/serviceflow/types';

export const metadata = { title: 'Settings · Orion' };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <StructuredListRow>
      <StructuredListCell noWrap>{label}</StructuredListCell>
      <StructuredListCell>{children}</StructuredListCell>
    </StructuredListRow>
  );
}

function minor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

// Admin only (D6): the ServiceFlow connection key (D5). Checks the connection live on
// every visit, so a revoked or broken connection shows here straight away.
export default async function SettingsPage() {
  await requireAdmin();
  const connection = await loadConnection();

  let live: Connection | null = null;
  let problem: { message: string; code: string; detail?: string } | null = null;
  if (connection.state === 'ready') {
    try {
      live = (await getConnection(connection.key)).data;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      problem = { message: err.explanation, code: err.code, detail: err.detail };
    }
  }

  return (
    <div className="orion-narrow">
      <h1 className="cds--type-productive-heading-04">Settings</h1>
      <h2 className="cds--type-productive-heading-03 orion-section">ServiceFlow connection</h2>

      {connection.state === 'none' && (
        <p className="orion-section">
          No connection key is set, so Orion has no data to show. Paste the key from the ServiceFlow site
          below.
        </p>
      )}

      {connection.state === 'unreadable' && (
        <InlineNotification kind="error" lowContrast hideCloseButton
          title="The saved connection key can't be decrypted."
          subtitle="ORION_ENCRYPTION_KEY has changed or is missing. Paste the connection key again (Replace key)." />
      )}

      {connection.state !== 'none' && (
        <StructuredListWrapper aria-label="ServiceFlow connection" isCondensed>
          <StructuredListBody>
            <Detail label="Connection key">Set (never shown again after saving)</Detail>
            <Detail label="Connection ID">{connection.summary.connectionId}</Detail>
            {live ? (
              <>
                <Detail label="Site">{live.site.name} ({live.site.url})</Detail>
                <Detail label="Connection name">{live.connection.label}</Detail>
                <Detail label="ServiceFlow plugin">{live.site.plugin_version}</Detail>
                <Detail label="API version">
                  {live.site.api_version}
                  {minor(live.site.api_version) !== minor(CONTRACT_API_VERSION) &&
                    ` (Orion was built for ${CONTRACT_API_VERSION}; some things may not work)`}
                </Detail>
                <Detail label="Account linking">
                  {live.linking.available ? 'Available' : 'Not available: the site needs HTTPS for account linking'}
                </Detail>
                <Detail label="Status">Connected</Detail>
              </>
            ) : (
              <Detail label="Site">{connection.summary.site}</Detail>
            )}
          </StructuredListBody>
        </StructuredListWrapper>
      )}

      {problem && (
        <InlineNotification kind="error" lowContrast hideCloseButton
          title={`The connection isn't working. ${problem.message}`} subtitle={errorSubtitle(problem.code, problem.detail)} />
      )}

      <div className="orion-section">
        <ConnectionKeyForm hasKey={connection.state !== 'none'} />
      </div>
    </div>
  );
}
