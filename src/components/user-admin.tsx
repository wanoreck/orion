'use client';

import { useActionState } from 'react';
import { Button, Form, PasswordInput, Select, SelectItem, Stack, TextInput } from '@carbon/react';
import { createUserAction, setUserActiveAction } from '@/app/actions/users';
import { FormMessage } from './auth-forms';

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUserAction, undefined);
  return (
    <Form action={action} aria-label="Create an account">
      <Stack gap={6}>
        <FormMessage state={state} />
        <TextInput id="new-name" name="name" labelText="Name" autoComplete="off" required
          defaultValue={state?.values?.name} />
        <TextInput id="new-email" name="email" type="email" labelText="Email" autoComplete="off" required
          defaultValue={state?.values?.email} />
        <Select id="new-role" name="role" labelText="Role" defaultValue={state?.values?.role ?? 'user'}>
          <SelectItem value="user" text="User: works with the connected site's data" />
          <SelectItem value="admin" text="Admin: also manages accounts and settings" />
        </Select>
        <PasswordInput id="new-password" name="password" labelText="Initial password"
          autoComplete="new-password" helperText="At least 12 characters. Give it to them directly; they can change it under Account."
          required />
        <Button type="submit" disabled={pending}>Create account</Button>
      </Stack>
    </Form>
  );
}

/** Deactivate / Reactivate button for one row of the accounts table. */
export function ActiveToggle({ userId, active, label }: { userId: string; active: boolean; label: string }) {
  const [state, action, pending] = useActionState(setUserActiveAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <Button type="submit" size="sm" kind={active ? 'danger--tertiary' : 'tertiary'} disabled={pending}
        aria-label={`${active ? 'Deactivate' : 'Reactivate'} ${label}`}>
        {active ? 'Deactivate' : 'Reactivate'}
      </Button>
      {state?.error && <p className="orion-row-error" role="alert">{state.error}</p>}
    </form>
  );
}
