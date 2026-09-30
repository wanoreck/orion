# ServiceFlow API Contract (for Orion)

API version **0.2.0** · ServiceFlow plugin **1.5.0** · copied 2026-09-30

**Source of truth:** the ServiceFlow repo (github.com/wanoreck/serviceflow),
`plugin/plugin-architecture.md` §4.0 and `plugin/includes/api/`. This file is Orion's copy.
**Don't change the API from the Orion side.** If Orion needs something the API doesn't
offer, add it to `docs/API-REQUESTS.md` for the ServiceFlow side to build. When the API
changes, this file is updated to match, and `GET /connection` → `site.api_version` tells you
which version a site runs.

---

## 1. Connection key

An admin creates a connection in the ServiceFlow site's wp-admin (**Settings → Orion**) and
pastes the resulting key into Orion's settings. Format:

```
sfk1_<base64url( JSON )>
JSON = { "v": 1, "api": "<REST root, e.g. https://site/wp-json/>", "site": "<home URL>",
         "id": "<connection UUID>", "key": "<base64url Ed25519 seed, 32 bytes>" }
```

- `key` is the **private key**. Treat the whole connection key as a secret: store it
  encrypted at rest, keep it server-side, and never log it or send it to the browser.
- `api` may be a pretty REST root (`https://site/wp-json/`) or a plain-permalink one
  (`https://site/?rest_route=/`). Build URLs to suit, as in section 2.
- One connection per Orion instance at a time (D3). Swapping keys points Orion at a different
  site.

## 2. Signing every request

Every request, including reads, carries four headers:

| Header | Value |
|---|---|
| `X-SF-Connection` | the connection `id` |
| `X-SF-Timestamp` | Unix seconds; must be within ±300 s of the server clock |
| `X-SF-Nonce` | 16–64 chars of `A–Z a–z 0–9 _ -`; random per request |
| `X-SF-Signature` | standard base64 of the Ed25519 signature of the canonical string |

Canonical string: seven lines joined with `\n`, no trailing newline:

```
SFv1
<HTTP method, uppercase>
<REST route, e.g. /serviceflow/v1/orders/42>
<canonical query>
<timestamp>
<nonce>
<lowercase hex SHA-256 of the raw request body; SHA-256 of "" when there's no body>
```

**Canonical query:** take the query parameters, drop `rest_route`, sort by key (byte order),
encode each key and value with **RFC 3986** percent-encoding, join as `key=value` pairs with
`&`. Empty line if there are none. Values must be single scalars; no arrays.
In JavaScript, `encodeURIComponent()` is almost RFC 3986, but you must also encode
`! ' ( ) *`:

```ts
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
```

**Signing in Node:** the seed is a raw 32-byte Ed25519 private key. Build a key object from it
as a JWK (`{ kty: 'OKP', crv: 'Ed25519', d: <base64url seed>, x: <base64url public key> }`)
or as PKCS#8 DER, then `crypto.sign(null, Buffer.from(canonical), privateKey)`.

**Reference implementation:** `tools/sf-api-request.php` in the ServiceFlow repo. If Orion's
signatures are rejected, compare the canonical string byte for byte against it.

Worked example of a canonical string (the body hash is SHA-256 of ""):
```
SFv1
GET
/serviceflow/v1/orders
a=1&search=it%27s%20%28a%29%2Ab%21
100
n
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

**Replay:** a non-GET request's nonce can never be reused within 10 minutes; a reuse returns
409 `sf_api_replayed`. GET nonces aren't tracked, but still send a fresh one.

## 3. Reads vs. writes (D7)

- **Read** routes need only a valid signature. That's how unlinked Orion accounts read.
- **Linked** routes (every write, plus `GET /me`) also need HTTP Basic auth with the linked
  staff member's **WordPress Application Password**: `Authorization: Basic base64(user_login:password)`.
  That password must have been issued **for this connection**. Other Application Passwords
  are refused with `sf_api_link_mismatch`.

### Linking an Orion account to a WordPress user (D6)

1. `GET /connection` → `linking` gives `available`, `authorize_url`, `app_id`, `app_name`.
   If `available` is false, the site isn't on HTTPS and no account can be linked.
2. Send the person's browser to `authorize_url` with query args `app_name`, `app_id`,
   `success_url`, `reject_url`. Both URLs must be `https://` Orion URLs.
3. They log in to WordPress and approve. WordPress redirects to `success_url` with
   `site_url`, `user_login`, and `password` in the query string, or to `reject_url` with
   `success=false`.
4. Orion stores `user_login` + `password` encrypted against that Orion account **and this
   connection**, then calls `GET /me` with them to confirm the link works.
5. Revoking the connection in wp-admin deletes every Application Password issued through
   it; a later linked call returns 401. Treat that as "link lost; relink".

## 4. Errors

Errors are JSON: `{ "code": "...", "message": "...", "data": { "status": N, ... } }`.

| Status | Code | Meaning |
|---|---|---|
| 401 | `sf_api_connection_required` | Missing signature headers |
| 401 | `sf_api_connection_unknown` | No such connection on this site (wrong site, or deleted) |
| 401 | `sf_api_connection_revoked` | Revoked in wp-admin. Show "connection revoked" and stop polling |
| 401 | `sf_api_signature_expired` | Clock skew over 300 s; `data.server_time` has the server's clock |
| 401 | `sf_api_signature_invalid` | Signature doesn't match. Check the canonical string |
| 400 | `sf_api_bad_nonce`, `sf_api_unsupported_query`, `sf_api_bad_time` | Malformed request |
| 409 | `sf_api_replayed` | Write nonce reused |
| 403 | `sf_api_link_required` | Linked route called without a linked account |
| 403 | `sf_api_link_mismatch` | Application Password wasn't issued for this connection |
| 403 | `sf_api_forbidden` | The linked WP user lacks access |
| 404 | `sf_api_order_not_found` | No such order, or it's trashed |
| 401 | *(WordPress core)* `incorrect_password` etc. | The Application Password is wrong or was deleted |

## 5. Conventions

- Datetimes: ISO 8601 with the site's offset (`2026-09-29T14:05:00-05:00`). Dates: `YYYY-MM-DD`.
- Money: floats in USD, except Stripe amounts, which are integer cents in `*_cents` fields.
- Paginated lists: JSON array plus `X-WP-Total` and `X-WP-TotalPages` headers; `page`,
  `per_page` (≤100).
- Every response has `X-SF-Server-Time` (Unix seconds). **Use it as your next polling
  cursor**, never Orion's own clock.
- Reads have no side effects. Nothing is marked read by fetching it.

## 6. Polling (D18: every 10 seconds while a screen is open)

- Order lists: `GET /orders?changed_since=<last X-SF-Server-Time>`. Returns orders changed at
  or after that time (**inclusive**, so de-duplicate by `id`), **including trashed ones**
  (`is_trashed: true`, remove them). It defaults to `status=all`, so orders that *left* a tab
  also come back; re-sort them into tabs locally.
- One open order: `GET /orders?include=<id>&changed_since=<cursor>`. It's cheap, and when it
  returns the order, re-fetch `GET /orders/{id}`.
- Open message thread: `GET /orders/{id}/messages?since=<cursor>`.
- Activity feed: `GET /orders/{id}/activity?since=<cursor>`.

## 7. Routes

All under `/serviceflow/v1`.

### `GET /connection` (read)
```
{ connection: { id, label, created_at },
  site: { name, url, timezone, currency, stripe_mode, plugin_version, api_version },
  linking: { available, authorize_url, app_id, app_name } }
```

### `GET /me` (linked)
```
{ id, public_id, username, name, first_name, last_name, email, avatar_url, roles[],
  link: { name, created_at } }
```

### `GET /orders` (read)
Query: `status` (tab key from `/orders/counts`; default `active`), `customer_id`,
`assignee` (user ID, `none`, or `me`; `me` needs a linked account), `flag` (`rush` |
`priority`), `search` (title, or an exact public ID like `ORD-9A4X2`), `include` (comma IDs),
`changed_since`, `orderby` (`date` | `modified` | `title`), `order` (`asc` | `desc`),
`page`, `per_page`.

Each item (**OrderSummary**):
```
{ id, public_id, title, status: { key, label }, customer: CustomerRef|null,
  assignee: UserRef|null, deadline: date|null, is_rush, is_priority, is_quote,
  quote_status|null, awaiting_review, cancel_requested, total, is_trashed,
  created_at, changed_at }
CustomerRef = { id, public_id, name }
UserRef     = { id, name, avatar_url }
OrderRef    = { id, public_id, title, status: { key, label } }
```
Status keys: `draft`, `placed`, `progress`, `delivery`, `completed`, `on_hold`,
`pending-approval`, `cancelled`.

### `GET /orders/counts` (read)
`[ { key, label, count } ]` for tabs `active`, `draft`, `placed`, `progress`, `delivery`,
`on_hold`, `pending_approval`, `completed`, `cancelled`, `all`.

### `GET /orders/{id}` (read)
OrderSummary plus:
```
requirements: { type, deadline, instructions, custom_fields: [ { key, name, type, value, other } ] }
items:        [ { title, qty, price, line_total, est_hours, taxable, specs: {} } ]
totals:       { subtotal, discount, discount_label, total, tax_note }
promotion:    { id, name, code, discount_type, discount_value, discount_amount, applied_at } | null
tasks:        [ { id, type: "section", label }
              | { id, type: "milestone", label, date }
              | { id, type: "task", section_id, label, notes, assignee: UserRef|null, due_date, flagged, completed } ]
files:        [ { id, name, type, source: "upload"|"external", url, service, extension, mime_type,
                  size, iteration, proof_decision, uploaded_by, uploaded_at } ]
proofs:       { current_iteration, awaiting_review, mode, history: [ { number, outcome, reason, closed_at } ] }
quote:        { is_quote, status, approved_by, approved_via, approved_at, billing_edited_after_quote }
cancellation: { requested, request_reason, reason, rejection_reason, previous_status }
payment:      { method, secondary_method, auto_complete_on_payment, active_draft_invoice_id,
                invoices: [ { stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents,
                              currency, created_at, hosted_url, pdf_url, is_test, sent_to_customer } ] }
reference_order: OrderRef|null
referenced_by:   [ OrderRef ]
kits:            [ { id, public_id, title } ]
scheduling:      { estimated_hours, scheduled_hours, actual_hours, percentage, status, status_text,
                   blocks: [ { id, user: UserRef, start, end, all_day, task_label } ] }
checklist:       { active: [Item], ignored: [Item] }   Item = { id, severity, text, action, source, section }
counts:          { messages, files }
```

### `GET /orders/{id}/activity` (read)
Query: `limit` (0 = all), `include_hidden` (default true), `since`.
`[ { id, created_at, message, type, activity_key, actor: { type, name }, hidden_from_customer } ]`,
newest first.

### `GET /orders/{id}/notes` (read)
`[ { id, title, content_html, content_text, author: UserRef, pinned, pinned_at, created_at, updated_at } ]`,
pinned first.

### `GET /orders/{id}/messages` (read)
Query: `since`.
```
{ messages: [ { id, sent_at, author: { type: "team"|"client"|"system", user_id, name }, body, unread } ],
  unread_count, last_read_at, can_send }
```
Oldest first. `unread`/`last_read_at` are relative to the linked caller (without a linked
account, `last_read_at` is null).

### `GET /orders/{id}/emails` (read)
`[ { sent_at, trigger_key, trigger_label, to, subject, success } ]`, newest first.

### Not built yet
Docket, customers, tickets, schedule, work sessions, file downloads, reporting, and every
write action. See the ServiceFlow repo's CLAUDE.md "The plan".
