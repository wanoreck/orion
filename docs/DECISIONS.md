# ServiceFlow + Orion: Decisions

> **Copy in the Orion repo.** The original lives in the ServiceFlow repo (`DECISIONS.md`),
> copied 2026-09-30. New decisions about Orion itself are recorded **here**; decisions about the
> API or plugin are recorded in the ServiceFlow repo. Cross-cutting ones go in both.

The record of what's been decided, why, and what each decision implies. Newest decisions go
at the bottom of their section. If a decision changes, strike it through and add the
replacement with a date. Don't silently rewrite history. Questions still waiting on an answer
are at the end.

---

## 1. Product

**D1. Orion is the control panel.** *(2026-09-29)*
Orion is the staff control panel for ServiceFlow. It must feel like a first-class product,
not an add-on to the plugin or a reskin of wp-admin. The API is designed as clean resources
for a standalone app. wp-admin keeps working alongside it.

**D2. ServiceFlow stays the system of record.** *(2026-09-29)*
All business data lives in the ServiceFlow WordPress plugin. Orion never touches the
WordPress database or files. It only uses the ServiceFlow REST API (`serviceflow/v1`), and
every action goes through the same plugin functions wp-admin uses.

**D3. One Orion instance can be pointed at any ServiceFlow site, one site at a time.** *(2026-09-30)*
You can run any number of Orion instances. Each one is connected to **exactly one**
ServiceFlow site at a time, by entering that site's connection key in Orion's settings. To
work with two sites at once, run two Orion instances. Swapping keys should be seamless and
snappy: point Orion at a different ServiceFlow site, and it works against that site's data
immediately. No site switcher is needed in Orion.
- *Implication:* Orion must not keep its own long-lived copy of ServiceFlow data, or assume
  IDs from one site are valid on another. Anything it caches is keyed by connection.
- *Implication:* account links (D6) belong to one ServiceFlow site, because WordPress users
  differ per site. Orion stores links per connection, so switching back to a previous site
  restores them, and a new site needs fresh links.

**D4. With no connection, Orion is empty, not broken.** *(2026-09-30)*
If an Orion instance has no ServiceFlow connection key, it loads normally, shows no data, and
shows a notification explaining that a connection is needed and where to add it.

## 2. Connecting Orion to ServiceFlow

**D5. Connection keys are issued by ServiceFlow and entered into Orion.** *(2026-09-30)*
An admin on the ServiceFlow WordPress site generates a connection (a Connection ID plus a
secret, shown once) on a new "Orion Connections" settings screen. That connection is entered
in an Orion instance's settings. Each Orion instance gets its own connection, and each can be
revoked independently in wp-admin.
- The plugin **rejects `serviceflow/v1` requests that don't carry a valid connection
  signature.** Requests are signed with the secret and include a timestamp, so a captured
  request can't be replayed. This also closes the earlier question of whether the API should
  accept requests from anywhere other than Orion.
- *Replaces the part of the 2026-09-29 decision that made per-staff Application Passwords the
  only way in. They still exist, but now for write access (D6).*

**D6. Orion user accounts are Orion's own, and can optionally be linked to a WordPress user.** *(2026-09-30)*
- Orion has its own user accounts, starting with an initial admin account created at setup.
- **Login is email + password.** TOTP two-factor is planned for later.
- **Two roles to start:**
  - **Admin:** creates and manages Orion user accounts and manages Orion's settings,
    including the ServiceFlow connection key.
  - **User:** works in Orion against the connected ServiceFlow site (orders, customers, and
    so on).
  - Either role can be linked to a WordPress account. Edit actions still require a link
    (D7), whatever the Orion role.
- Any Orion account, including the admin, can be **linked** to a WordPress user on the
  connected ServiceFlow site. Linking uses WordPress's built-in "Authorize Application" flow:
  the person is sent to the WP site, logs in and approves, and WordPress creates an
  Application Password for them labeled for that Orion instance and hands it back. Nobody
  copies passwords by hand.
- **Linking is optional.** An unlinked account can use Orion read-only, sees a warning that
  it isn't linked, and **cannot take any edit action.**
- A linked account's actions are performed as their WordPress user, so the activity log shows
  their real name. They can do what their WordPress capabilities allow; today that's
  `manage_options`, the same as wp-admin.
- **Rejected:** a shared service account, and an "acting as user X" field on requests.
  *(2026-09-29)*

**D7. Reads use the connection; writes need the connection plus a linked account.** *(2026-09-30, derived from D5 + D6)*
- **Read** requests are authorized by the connection alone. That's what lets unlinked
  accounts read.
- **Write** requests need both a valid connection signature *and* the linked user's
  Application Password. The plugin refuses writes without both, so the read-only rule for
  unlinked accounts is enforced by ServiceFlow itself, not only hidden in Orion's UI.
- *Consequence:* anyone who can log in to an Orion instance can read everything that
  instance's connection can see, including customer contact details. Orion's own logins and
  account management are therefore the gate for read access. **Accepted as-is for now**
  (2026-09-30). The connection has full read scope, and this can be tightened later.

## 3. Hosting and deployment

**D8. Everything runs on the home server under Coolify.** *(2026-09-29, extended 2026-09-30)*
The server runs Ubuntu. Orion is a Coolify Docker app. For now a **test WordPress site with
ServiceFlow installed** also runs on the same Coolify instance. They'll be separated later.
- **Orion will not be connected to the live production ServiceFlow site** until explicitly
  decided.
- HTTPS for both comes from the existing Cloudflare + Traefik setup. WordPress requires
  HTTPS for Application Passwords, and the account-link flow redirects over HTTPS.

**D9. Claude Code runs on the server, restricted to Orion's files.** *(2026-09-30)*
- A dedicated non-root Linux user (e.g. `orion-dev`) with no sudo, **not** in the `docker`
  group. Its home directory holds only the Orion repo.
- Claude Code sandboxing and permission rules keep it inside the Orion directory.
- Git access is a deploy key with write access to the Orion repo only.
- You reach that session from any browser or phone via Remote Control.

**D10. Orion deploys by git push; Coolify builds.** *(2026-09-30)*
Claude commits and pushes to the Orion repo. Coolify watches the repo and builds and deploys.
Claude does not control Coolify or Docker directly.

**D11. Two private GitHub repositories.** *(2026-09-30)*
- **Orion:** a new private repo for the Orion app.
- **ServiceFlow:** a new private repo for the plugin. It currently has no remote; today it
  lives in the local `serviceflow/` folder alongside the planning docs.
- The plugin (including the `serviceflow/v1` API) is developed separately from Orion. The
  server-side Claude session only ever sees Orion.
- **The repos are completely separate** *(2026-09-30)*. The ServiceFlow repo holds only the
  plugin and ServiceFlow material (including `SERVICEFLOW-INVENTORY.md` and the plugin docs).
  The Orion repo holds only Orion material. The two are connected at runtime by keys, never
  by shared code. The **API contract** (routes, auth, and response shapes) is the one thing
  both sides depend on; it's defined in the ServiceFlow repo, and Orion keeps a copy it
  builds against.

**D15. The test WordPress site updates the plugin from GitHub, through the normal Plugins screen.** *(2026-09-30)*
Goal: you click "Update" on ServiceFlow in wp-admin's Plugins list, with no zip uploads.
Plan:
- Tagging a release in the ServiceFlow repo triggers GitHub Actions to build the plugin zip
  (running `composer install --no-dev` so `vendor/` is included) and attach it to a GitHub
  Release.
- The plugin gains a small update checker that asks the private repo for its latest release
  and feeds it into WordPress's own update system. It uses a read-only GitHub token stored
  in `wp-config.php`, never in the database or the repo.
- The same mechanism would work for production later, but production only gets it when you
  decide.

**D16. Orion's stack.** *(2026-09-30, chosen by Claude at the user's request)*
- **Next.js (App Router) with TypeScript**, built as a single standalone Docker image for
  Coolify.
- **PostgreSQL** for Orion's own data (users, roles, sessions, settings, the connection key,
  account links). Runs as a Coolify database service with backups. It holds no ServiceFlow
  business data (D2, D3).
- **Drizzle ORM** for schema and migrations.
- ~~Tailwind CSS with shadcn/ui for the interface.~~ Replaced by D17 *(2026-09-30)*.
- **All ServiceFlow API calls happen on Orion's server**, never in the browser. The
  connection secret and staff Application Passwords never reach the browser. They're stored
  **encrypted at rest** in Postgres, with the encryption key supplied as a Coolify
  environment variable.
- **Own authentication:** email + password hashed with Argon2, and database-backed sessions
  in secure HTTP-only cookies. That keeps adding TOTP later straightforward.
- *Why:* one language and one app for the UI and the server layer; server-side rendering
  keeps secrets off the client; a large ecosystem for future features (real-time updates,
  background jobs, file handling); Postgres scales well beyond what Orion will need and
  Coolify manages it well; TypeScript types for the API contract catch mismatches with
  ServiceFlow at build time.

**D17. Orion's interface uses IBM's Carbon Design System, with Epic-inspired workflows.** *(2026-09-30)*
- UI components come from **Carbon** (`@carbon/react`, with Carbon's Sass themes and IBM
  Plex type). Carbon is the design language; don't mix in a second component library.
- Specific page layouts and workflows will be **inspired by Epic's Hyperspace EMR and Epic
  apps**: dense, keyboard-friendly, workspace-style screens for high-volume staff work. You
  will supply screenshots and references when UI design starts. Don't invent that visual
  direction ahead of them.
- Fits the rest of D16 unchanged: Carbon's React components work with Next.js.

**D18. Live updates by polling, every 10 seconds.** *(2026-09-30)*
While a relevant screen is open (a message thread, an order, a list), Orion's server asks
ServiceFlow for changes every 10 seconds. Push notifications (ServiceFlow → Orion) are a
possible later upgrade, not planned now.
- *Implication for the API:* poll requests should be cheap. Endpoints Orion polls should
  support "changed since" filters, so each poll returns only what's new instead of
  re-fetching everything.

**D19. Remaining audit bugs.** *(2026-09-30)*
- **Fix now** *(done 2026-09-30)*: §7.4 (assignee changes logged everywhere, via one shared function), §7.5
  (single-order flag changes logged), §7.6 (default-assignee note goes to the real activity
  log), §7.8 (order-type checks on wp-admin links), §7.11 (no-op status changes are refused
  instead of re-logged and re-emailed).
- **Leave as-is for now:** §7.9 (ticket replies/status don't email the customer), §7.10
  (staff quote approval skips the B2B check), §7.12 (declined cancellation requests aren't
  emailed).

## 4. API conventions

**D12. API shape.** *(2026-09-29)*
JSON resources only, never HTML fragments. Reads have no side effects. ISO 8601 datetimes in
the site timezone. Paginated collections carry `X-WP-Total` / `X-WP-TotalPages` headers.
Full reference: `plugin/plugin-architecture.md` §4.0.

**D13. TOTP-gated actions stay out of the API** until step-up is designed for it. *(2026-09-29)*
That covers file delete, customer delete, Stripe link/unlink/void, subscriptions, and
Settings.

**D14. Currency is USD.** The plugin hardcodes it for every Stripe call. *(2026-09-29)*

---

## Open questions

1. ~~One connection or several?~~ One at a time (D3).
2. ~~Orion login and roles?~~ Email + password, Admin and User roles (D6).
3. ~~Read scope for unlinked accounts?~~ Full read access for now (D7).
4. ~~Repo split details?~~ Completely separate repos (D11).
5. ~~Orion stack?~~ Chosen (D16).
6. ~~Plugin updates on the test site?~~ From GitHub releases via the Plugins screen (D15).
7. ~~Live updates?~~ Polling every 10 seconds (D18).
8. ~~Remaining audit bugs?~~ Five fixed now, three left as-is (D19).

No open questions right now. The proposals below are kept for the reasoning behind D18 and
D19.

### Proposal: live updates

When something changes in ServiceFlow (a client sends a message, approves a proof, or a
status changes), how does an open Orion screen find out without you pressing refresh?
- **Polling (proposed to start):** Orion's server re-asks ServiceFlow on a timer while the
  relevant screen is open. For example, an open message thread every ~10 seconds, and order
  lists every ~60 seconds or when you come back to the tab. It's simple and reliable, and
  it's how wp-admin's message thread already works. Cost: updates arrive seconds late, and
  there's some idle traffic.
- **Push (later, if wanted):** ServiceFlow sends a signed notification to Orion the moment
  something changes, and Orion forwards it to open browsers instantly. It's faster, but it
  needs ServiceFlow to be able to reach Orion's URL, plus more moving parts.

### Proposal: remaining audit bugs

Open items from `SERVICEFLOW-INVENTORY.md` §7. Each matters when the related action is added
to the API. Recommendation per item:

| # | Problem | Recommendation |
|---|---|---|
| 4 | Changing an order's assignee is only logged from Work Queue bulk actions, not from Dispatch reassign, Take Order, or the order save | **Fix** with one shared "assign order" function that always logs, before the assign action goes into the API |
| 5 | Setting rush/priority on a single order isn't logged (bulk is) | **Fix** the same way, before the flag action |
| 6 | The "default assignee applied" note on new orders is written to an old storage spot the log screen no longer reads, so it's invisible | **Fix** (one line: write it to the real activity log) |
| 8 | A few wp-admin links don't check that the ID is actually an order (approve proof, remove customer, delete log, assign customer) | **Fix** (small hardening, same pattern as the kit fix) |
| 9 | Staff replies to support tickets, and ticket status changes, never email the customer | **Your call:** add "ticket reply" / "ticket status" email templates (off by default, like the others), or keep tickets silent |
| 10 | Staff "approve quote on customer's behalf" skips the B2B company-approval check that customer approvals go through | **Your call:** apply the same check, or keep staff able to override it deliberately |
| 11 | Setting an order to the status it already has re-logs and re-sends the email | **Fix in the API:** the status action refuses a no-op change instead of repeating it |
| 12 | Rejecting a customer's cancellation request doesn't tell the customer | **Your call:** add a "cancellation request declined" email, or keep it silent |
