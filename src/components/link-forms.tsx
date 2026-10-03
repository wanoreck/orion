'use client';

import { useActionState } from 'react';
import { Button } from '@carbon/react';
import { startLinkAction, unlinkAction } from '@/app/actions/links';
import { FormMessage } from './auth-forms';

/** Sends the browser to WordPress to approve an Application Password for Orion. */
export function LinkButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState(startLinkAction, undefined);
  return (
    <form action={action} className="orion-inline-form">
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Opening WordPress…' : label}</Button>
    </form>
  );
}

export function UnlinkButton() {
  const [state, action, pending] = useActionState(unlinkAction, undefined);
  return (
    <form action={action} className="orion-inline-form">
      <FormMessage state={state} />
      {!state?.success && (
        <Button type="submit" kind="danger--tertiary" disabled={pending}>Unlink WordPress account</Button>
      )}
    </form>
  );
}
