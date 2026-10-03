// Response shapes from docs/API-CONTRACT.md §7 (API 0.2.0). Datetimes are ISO 8601 strings
// with the site's offset; dates are YYYY-MM-DD (§5).

export type Connection = {
  connection: { id: string; label: string; created_at: string };
  site: {
    name: string;
    url: string;
    timezone: string;
    currency: string;
    stripe_mode: string;
    plugin_version: string;
    api_version: string;
  };
  linking: { available: boolean; authorize_url: string; app_id: string; app_name: string };
};

export type OrderStatusKey =
  | 'draft'
  | 'placed'
  | 'progress'
  | 'delivery'
  | 'completed'
  | 'on_hold'
  | 'pending-approval'
  | 'cancelled';

export type CustomerRef = { id: number; public_id: string; name: string };
export type UserRef = { id: number; name: string; avatar_url: string };
export type OrderRef = { id: number; public_id: string; title: string; status: { key: OrderStatusKey; label: string } };

export type OrderSummary = {
  id: number;
  public_id: string;
  title: string;
  status: { key: OrderStatusKey; label: string };
  customer: CustomerRef | null;
  assignee: UserRef | null;
  deadline: string | null;
  is_rush: boolean;
  is_priority: boolean;
  is_quote: boolean;
  quote_status: string | null;
  awaiting_review: boolean;
  cancel_requested: boolean;
  total: number;
  is_trashed: boolean;
  created_at: string;
  changed_at: string;
};

/** Tab keys from GET /orders/counts. Note pending_approval here vs pending-approval as a status. */
export type OrderTabKey =
  | 'active'
  | 'draft'
  | 'placed'
  | 'progress'
  | 'delivery'
  | 'on_hold'
  | 'pending_approval'
  | 'completed'
  | 'cancelled'
  | 'all';

export type OrderCount = { key: OrderTabKey; label: string; count: number };

export type OrderListQuery = {
  status?: OrderTabKey;
  customer_id?: number;
  /** A user ID, `none`, or `me` (`me` needs a linked account). */
  assignee?: number | 'none' | 'me';
  flag?: 'rush' | 'priority';
  search?: string;
  /** Order IDs, comma-joined into one value (the API accepts no arrays). */
  include?: number[];
  /** A previous response's X-SF-Server-Time (§6). */
  changed_since?: number;
  orderby?: 'date' | 'modified' | 'title';
  order?: 'asc' | 'desc';
  page?: number;
  /** At most 100. */
  per_page?: number;
};
