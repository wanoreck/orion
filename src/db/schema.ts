import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Orion's own data only (D3). Nothing from ServiceFlow is stored long-term.

/** Instance-wide settings, one row per key. Secret values are encrypted before they get here. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
