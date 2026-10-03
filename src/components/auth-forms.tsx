'use client';

import { useActionState } from 'react';
import { Button, Form, InlineNotification, PasswordInput, Stack, TextInput } from '@carbon/react';
import { changePasswordAction, loginAction, setupAction } from '@/app/actions/auth';
import type { FormState } from '@/app/actions/form-state';

export function FormMessage({ state }: { state: FormState }) {
  if (state?.error) {
    return (
      <InlineNotification kind="error" title={state.error} subtitle={state.code ? `Code: ${state.code}` : undefined}
        lowContrast hideCloseButton role="alert" />
    );
  }
  if (state?.success) {
    return <InlineNotification kind="success" title={state.success} lowContrast hideCloseButton role="status" />;
  }
  return null;
}

const NEW_PASSWORD_HELP = 'At least 12 characters.';

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  return (
    <Form action={action} aria-label="Create the first Admin account">
      <Stack gap={6}>
        <FormMessage state={state} />
        <TextInput id="name" name="name" labelText="Your name" autoComplete="name" required
          defaultValue={state?.values?.name} />
        <TextInput id="email" name="email" type="email" labelText="Email" autoComplete="email" required
          defaultValue={state?.values?.email} />
        <PasswordInput id="password" name="password" labelText="Password" autoComplete="new-password"
          helperText={NEW_PASSWORD_HELP} required />
        <PasswordInput id="confirm" name="confirm" labelText="Confirm password" autoComplete="new-password" required />
        <Button type="submit" disabled={pending}>Create Admin account</Button>
      </Stack>
    </Form>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Form action={action} aria-label="Sign in">
      <Stack gap={6}>
        <FormMessage state={state} />
        <TextInput id="email" name="email" type="email" labelText="Email" autoComplete="username" required
          defaultValue={state?.values?.email} />
        <PasswordInput id="password" name="password" labelText="Password" autoComplete="current-password" required />
        <Button type="submit" disabled={pending}>Sign in</Button>
      </Stack>
    </Form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <Form action={action} aria-label="Change password">
      <Stack gap={6}>
        <FormMessage state={state} />
        <PasswordInput id="current" name="current" labelText="Current password" autoComplete="current-password" required />
        <PasswordInput id="password" name="password" labelText="New password" autoComplete="new-password"
          helperText={NEW_PASSWORD_HELP} required />
        <PasswordInput id="confirm" name="confirm" labelText="Confirm new password" autoComplete="new-password" required />
        <Button type="submit" disabled={pending}>Change password</Button>
      </Stack>
    </Form>
  );
}
