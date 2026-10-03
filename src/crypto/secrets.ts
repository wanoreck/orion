import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Secrets at rest (the connection key now; Application Passwords later) are encrypted with
// AES-256-GCM under ORION_ENCRYPTION_KEY, set in Coolify. Stored form:
//   v1.<base64url(12-byte IV | 16-byte auth tag | ciphertext)>
// `purpose` is bound in as associated data, so a value encrypted for one purpose can't be
// swapped into another field.

const VERSION = 'v1';

export class EncryptionKeyError extends Error {}

function encryptionKey(): Buffer {
  const raw = process.env.ORION_ENCRYPTION_KEY;
  if (!raw) throw new EncryptionKeyError('ORION_ENCRYPTION_KEY is not set.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new EncryptionKeyError('ORION_ENCRYPTION_KEY must be 32 random bytes, base64 (openssl rand -base64 32).');
  }
  return key;
}

export function encryptSecret(plaintext: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
}

/** Throws if the value was tampered with, made for another purpose, or under another key. */
export function decryptSecret(stored: string, purpose: string): string {
  const [version, payload] = stored.split('.');
  if (version !== VERSION || !payload) throw new Error('Unrecognized encrypted value');
  const data = Buffer.from(payload, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
