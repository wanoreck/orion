import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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

export const LINK_STATUSES = ['ok', 'broken'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/**
 * An Orion account's link to a WordPress user on one ServiceFlow connection (D6, contract
 * §3). Kept per connection: swapping the key needs new links, and switching back restores
 * these (D3).
 */
export const accountLinks = pgTable(
  'account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').notNull(),
    /** Encrypted JSON { user_login, password }, bound to this user and connection. */
    encryptedCredential: text('encrypted_credential').notNull(),
    wpUserId: integer('wp_user_id').notNull(),
    wpUsername: text('wp_username').notNull(),
    wpName: text('wp_name').notNull(),
    /** broken: the site rejected the credential (revoked, deleted, wrong connection). */
    status: text('status', { enum: LINK_STATUSES }).notNull().default('ok'),
    brokenCode: text('broken_code'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_links_user_connection_key').on(t.userId, t.connectionId),
    check('account_links_status_check', sql`${t.status} in ('ok', 'broken')`),
  ],
);

/**
 * One-time tokens tying WordPress's authorize redirect back to the Orion user and
 * connection that started it. The id is the SHA-256 of the token in the URL.
 */
export const linkStates = pgTable(
  'link_states',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
);

export type AccountLink = typeof accountLinks.$inferSelect;
