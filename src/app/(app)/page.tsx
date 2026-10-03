import { InlineNotification } from '@carbon/react';
import { requireUser } from '@/auth/current';
import { getOrderCounts } from '@/serviceflow/api';
import { ApiError } from '@/serviceflow/client';
import { loadConnection } from '@/serviceflow/connection';
import type { OrderCount } from '@/serviceflow/types';

// Placeholder home with a smoke test of the connection: order counts per tab.
// Real screens wait for the user's UI references (D17).
export default async function Home() {
  const user = await requireUser();
  const connection = await loadConnection();

  let counts: OrderCount[] | null = null;
  let problem: { message: string; code: string } | null = null;
  if (connection.state === 'ready') {
    try {
      counts = (await getOrderCounts(connection.key)).data;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      problem = { message: err.explanation, code: err.code };
    }
  } else if (connection.state === 'unreadable') {
    problem = { message: "The saved connection key can't be decrypted.", code: 'orion_key_unreadable' };
  }

  return (
    <>
      <h1 className="cds--type-productive-heading-04">Welcome, {user.name}</h1>
      <p>You&apos;re signed in as {user.role === 'admin' ? 'an Admin' : 'a User'}.</p>
      {problem && (
        <InlineNotification kind="error" lowContrast hideCloseButton className="orion-notice"
          title={`Couldn't load data from ServiceFlow. ${problem.message}`} subtitle={`Code: ${problem.code}`} />
      )}
      {counts && (
        <>
          <h2 className="cds--type-productive-heading-03 orion-section">Orders</h2>
          <ul className="orion-plain-list" aria-label="Order counts">
            {counts.map((tab) => (
              <li key={tab.key}>
                {tab.label}: {tab.count}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
