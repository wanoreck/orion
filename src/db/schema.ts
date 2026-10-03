import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Orion's own data only (D3). Nothing from ServiceFlow is stored long-term.

/** Instance-wide settings, one row per key. Secret values are encrypted before they get here. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

/** Orion's own accounts (D6). Emails are stored lowercased; see normalizeEmail(). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Argon2id hash in PHC string form. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    /** Deactivated accounts can't sign in and lose their sessions. */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_role_check', sql`${t.role} in ('admin', 'user')`),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * Database-backed sessions. The id is the SHA-256 of the cookie's token, so a leaked
 * database doesn't hand out working sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Idle expiry; pushed forward as the session is used, never past the absolute limit. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export type User = typeof users.$inferSelect;
