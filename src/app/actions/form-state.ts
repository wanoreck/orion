/** What a form's Server Action hands back to useActionState. */
export type FormState = {
  error?: string;
  /** A machine-readable code shown next to the error, e.g. the API's sf_api_* code. */
  code?: string;
  /** Technical specifics behind the error (host, network code, HTTP status). Admin-facing only. */
  detail?: string;
  success?: string;
  /** Echoed back so a failed submit doesn't clear what was typed (never passwords). */
  values?: Record<string, string>;
} | undefined;
