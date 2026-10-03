# Orion: Project Guide

> **Status (2026-10-03):** First build steps 1–5 done (scaffold; accounts; Settings and the
> connection key; the signed API client; WordPress account linking). Next step: the first
> read-only screens, once the user shares UI references (see "First build").
> Decisions are in **`docs/DECISIONS.md`**; they override anything here that disagrees.

**Orion** (github.com/wanoreck/orion, private) is the staff control panel for **ServiceFlow**,
a WordPress plugin for order and workflow management. ServiceFlow is the system of record;
Orion is how staff work with it. **Orion is the control panel** (D1): it must feel like a
first-class product in its own right, not an add-on to ServiceFlow or a reskin of wp-admin.

ServiceFlow lives in a separate repo (github.com/wanoreck/serviceflow). **This repo contains
only Orion.** The two are connected at runtime by a connection key, never by shared code.

## Where this runs, and how Claude works here (D8–D10)

- Orion runs on the home server (Ubuntu) as a **Coolify** Docker app. HTTPS comes from the
  existing Cloudflare + Traefik setup.
- Claude Code runs on that server as a restricted, non-root user that can see **only this
  repo**. Stay inside it; don't try to reach anything else on the server.
- **Deploying = pushing to `main`, then the user clicks Redeploy in Coolify.** Auto-deploy
  isn't possible yet: GitHub can't reach Coolify's webhook, because the server is only
  reachable over Tailscale. After pushing, tell the user it's ready to redeploy. Don't try to
  control Coolify or Docker directly.
- **Reaching a ServiceFlow site hosted on this same server** (like the test site): the
  site's hostname resolves to the server's Tailscale IP, and containers can't connect to that,
  nor to the host's own ports (both time out). The fix (2026-10-03) is a **network alias on
  Coolify's proxy container**: in Coolify → Servers → Proxy configuration, `coolify-proxy`'s
  `coolify` network has `aliases: [sfwptest.server.wanoreck.com]`, so Docker's internal DNS
  sends that hostname straight to Traefik. HTTPS and certificate checks still apply. Each
  additional same-server ServiceFlow site needs its own alias there. Sites hosted elsewhere
  (e.g. live production) need nothing. A timeout to a 100.x address is the symptom.
- A **test** ServiceFlow site (WordPress on the same Coolify) is what Orion connects to during
  development. **Never connect Orion to the live production ServiceFlow site** unless the user
  explicitly says to.

## The architecture rule (non-negotiable)

**Orion talks only to the ServiceFlow REST API (`serviceflow/v1`). It never touches the
WordPress database or files.**

- Everything Orion knows about orders, customers and so on comes from the API, and every
  change goes through it. The contract is **`docs/API-CONTRACT.md`**, a copy of the ServiceFlow
  side's reference.
- **Never change or work around the API from here.** If Orion needs something the API
  doesn't provide, write it up in `docs/API-REQUESTS.md` and tell the user; it gets built on
  the ServiceFlow side.
- Orion's own database holds **only Orion's own data**: users, roles, sessions, settings, the
  connection key, and account links. No long-lived copies of ServiceFlow business data (D3).
  Anything cached is keyed by connection and disposable.
- **All API calls happen on Orion's server**, never from the browser.

## How Orion connects (D3–D7)

- **One ServiceFlow site per Orion instance at a time.** An Admin pastes that site's
  **connection key** (from ServiceFlow's wp-admin → Settings → Orion) into Orion's settings.
  Swapping the key must work seamlessly against the new site.
- **No key → Orion still loads**, shows no data, and shows a notification explaining where to
  add one. It must never look broken.
- **Every API request is signed** with the connection key (Ed25519). See the contract §2.
- **Orion has its own accounts**: email + password login (TOTP planned later), with two roles:
  - **Admin:** manages Orion users and settings, including the connection key.
  - **User:** works with the connected site's data (orders, customers, …).
- **Linking to WordPress is optional per account.** A linked account's actions are performed as
  that WordPress user (the contract §3 covers the link flow). **Unlinked accounts are
  read-only**: show a clear "not linked" warning, and don't offer edit actions. ServiceFlow
  enforces this too.
- Links belong to a connection. When the key is swapped to another site, accounts need to link
  again for that site; keep old links so switching back restores them.

## Secrets

- The connection key and every stored Application Password are **encrypted at rest** in
  Postgres, with the encryption key from an environment variable (set in Coolify).
- Secrets never reach the browser, never appear in logs or error messages, and are never
  committed. `.env*` files stay out of git; provide a `.env.example` with placeholder values.

## Stack (D16, D17)

- **Next.js (App Router) + TypeScript**, built as a single standalone Docker image.
- **PostgreSQL** (a Coolify database service) + **Drizzle ORM** for schema and migrations.
- Auth: Orion's own email + password (Argon2 hashing), database-backed sessions in secure,
  HTTP-only cookies.
- UI: **IBM Carbon Design System** (`@carbon/react`, Carbon Sass themes, IBM Plex). Don't mix
  in another component library.
- Screen layouts and workflows are **inspired by Epic's Hyperspace EMR / Epic apps**: dense,
  keyboard-friendly workspace screens. **Wait for the user's screenshots and references before
  designing screens.** Scaffolding, auth, and settings plumbing don't need them.
- **Live updates by polling every 10 seconds** while a screen is open (D18), using the API's
  `changed_since` / `since` parameters and the `X-SF-Server-Time` header as the cursor
  (contract §6).

## First build (suggested order)

1. Scaffold the Next.js + TypeScript app, a Dockerfile (standalone output), `.env.example`, a
   health-check route, and the Postgres connection with Drizzle migrations.
2. Orion accounts: a first-run setup screen that creates the initial Admin, then login,
   logout and sessions.
3. Settings (Admin only): paste or replace the connection key, verify it with
   `GET /connection`, and show the site's name and status. Show the "no connection" state
   everywhere else.
4. The server-side ServiceFlow API client: signing, error handling for every contract §4 code,
   and typed responses.
5. Account linking via WordPress's authorize flow (contract §3), with an "unlinked, read-only"
   warning for unlinked accounts.
6. The first read-only screens, once the user has shared UI references.

## Testing

`npm test` (unit) and `npm run test:e2e` (production build over HTTP, after `npm run build`)
need `TEST_DATABASE_URL`, a throwaway database whose name contains `test`. Postgres 18 is
installed on the server (`/usr/lib/postgresql/18/bin`) for a local throwaway cluster; the
sandbox stops background processes when a command ends, so start and stop it in the same
command as the tests. Add every new page to `tests/e2e/render.test.mts` (client-side render
check). Carbon's InlineNotification and ToastNotification throw in the browser if they contain
links or buttons; put actions outside them.

## Working agreements

- **Errors are specific, never secret (D20).** Show the exact code (Orion's, `sf_api_*`, or
  network/TLS like `ENOTFOUND`), the host:port, HTTP status and the other side's message;
  technical detail to Admins, plain explanation plus code to Users. Never keys, signatures,
  passwords, tokens or full database URLs. No generic "something went wrong".
- Small steps; commit each working step with a clear message. Pushing to `main` deploys, so
  don't push anything that doesn't build.
- Keep this file and `docs/DECISIONS.md` current. New decisions from the user are added there,
  dated.
- Record anything the user decides that affects the ServiceFlow side in `docs/API-REQUESTS.md`
  or as a note for the user, so it reaches the ServiceFlow repo.
