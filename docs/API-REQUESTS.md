# API requests (Orion → ServiceFlow)

Things Orion needs that the ServiceFlow API (`docs/API-CONTRACT.md`) doesn't provide yet.
Orion never changes the API itself. Add a request here and tell the user; it gets built in
the ServiceFlow repo, then `docs/API-CONTRACT.md` is updated.

Format: date, what's needed, why (which screen or action), and any shape you'd like.

## Open requests

### 2026-10-03: Revoke the caller's Application Password (`DELETE /me/link`)

**What:** a linked route that deletes the Application Password the request authenticated
with (the one issued through this connection for this user). Response: `204`, or the usual
§4 errors.

**Why:** Orion's Account page has "Unlink WordPress account" (D6). Today Unlink can only
forget Orion's encrypted copy; the Application Password stays valid in WordPress until the
person deletes it by hand under Users → Profile → Application Passwords. Orion only talks to
`serviceflow/v1` (D2), so it can't call WordPress core's application-passwords routes. With
this route, Unlink would revoke it properly.

**Shape:** `DELETE /serviceflow/v1/me/link` (linked). No body.
