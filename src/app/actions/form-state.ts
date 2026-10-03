/** What a form's Server Action hands back to useActionState. */
export type FormState = {
  error?: string;
  success?: string;
  /** Echoed back so a failed submit doesn't clear what was typed (never passwords). */
  values?: Record<string, string>;
} | undefined;
