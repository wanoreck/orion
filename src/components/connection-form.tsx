'use client';

import { useActionState } from 'react';
import { Button, Form, PasswordInput, Stack } from '@carbon/react';
import { saveConnectionAction } from '@/app/actions/settings';
import { FormMessage } from './auth-forms';

/**
 * Paste or replace the connection key. Once a key is saved it's never sent back to the
 * browser: this form only ever sends a key, it doesn't show one.
 */
export function ConnectionKeyForm({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState(saveConnectionAction, undefined);
  const form = (
    <Form action={action} aria-label="Connection key">
      <Stack gap={5}>
        <PasswordInput id="key" name="key" labelText={hasKey ? 'New connection key' : 'Connection key'}
          helperText="In the ServiceFlow site's wp-admin: Settings → Orion → create a connection, then copy its key (starts with sfk1_)."
          autoComplete="off" spellCheck={false} data-1p-ignore required />
        <div>
          <Button type="submit" disabled={pending}>{pending ? 'Verifying…' : 'Verify and save'}</Button>
        </div>
      </Stack>
    </Form>
  );
  return (
    <Stack gap={5}>
      <FormMessage state={state} />
      {hasKey ? (
        // A native disclosure, so Replace works before (or without) JavaScript.
        <details className="orion-disclosure">
          <summary>Replace key</summary>
          {form}
        </details>
      ) : (
        form
      )}
    </Stack>
  );
}
