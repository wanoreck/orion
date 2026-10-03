# Orion

The staff control panel for ServiceFlow. It runs on Coolify and talks to a ServiceFlow site
only through the ServiceFlow REST API.

- **Guide for contributors (and Claude):** [CLAUDE.md](CLAUDE.md)
- **Decisions:** [docs/DECISIONS.md](docs/DECISIONS.md)
- **API contract:** [docs/API-CONTRACT.md](docs/API-CONTRACT.md)

## Development

Requires Node 24 and a Postgres database.

```sh
npm install
cp .env.example .env.local   # then fill in real values
npm run dev                  # http://localhost:3000
```

- `npm run build`: production build (standalone output, as used by the Docker image).
- `npm run typecheck`: TypeScript check.
- `npm run db:generate`: after changing `src/db/schema.ts`, generate a migration into `drizzle/`.
  Migrations are applied automatically when the server starts.
- `GET /api/health`: `200` when Orion and its database are up, `503` otherwise.

### Tests

Tests need a throwaway Postgres database whose name contains `test`. **Its contents are
deleted on every run.**

```sh
export TEST_DATABASE_URL=postgres://orion@127.0.0.1:5432/orion_test
npm test                        # unit tests (tests/unit)
npm run build && npm run test:e2e   # the production build, driven over HTTP (tests/e2e)
```

`tests/e2e/render.test.mts` loads every page in jsdom with Next.js's client scripts running,
so React hydrates and runs effects, and fails on any client-side error. Server-rendered HTML
alone doesn't show crashes like a Carbon component throwing in the browser. Add new pages
to it.

The ServiceFlow tests use a stand-in site (`tests/fake-serviceflow.mts`) that verifies
signatures from the receiving side with its own encoder, so client bugs can't hide behind
shared code.

## Accounts

Orion has its own accounts (D6): email + password, with Admin and User roles.

- **First run:** with no accounts, every page leads to `/setup`, which creates the first Admin.
  Setup closes for good once any account exists.
- **Admins** manage accounts at `/users`: create Users or Admins (with an initial password
  they pass on), deactivate and reactivate. Admins can't deactivate themselves, and the last
  active Admin can't be deactivated. Deactivating signs the account out immediately.
- **Everyone** can change their own password at `/account`, which signs out their other
  sessions.
- **Passwords:** at least 12 characters, hashed with Argon2id (19 MiB, 2 passes).
- **Sessions** live in Postgres; the cookie (`__Host-orion_session`: HttpOnly, Secure,
  SameSite=Lax) holds a random token and the database stores only its SHA-256. A session
  ends after 7 days without use or 30 days after sign-in, whichever comes first.
- **Sign-in throttling:** after 10 failed attempts for one email, or 30 from one client, in
  15 minutes, sign-in is refused until the window passes. Kept in memory, so a restart
  clears it.
- There's no password reset by email yet. If someone forgets their password, an Admin has to
  deactivate the account and create a new one with a different email.

## Deployment

Coolify builds the `Dockerfile` on every push to `main` and runs it on port 3000. Set these
environment variables in Coolify (see `.env.example`):

- `DATABASE_URL`: Orion's Postgres database (a Coolify database service).
- `ORION_ENCRYPTION_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`).

If the database can't be reached at startup, the container exits and Docker restarts it.

## ServiceFlow connection

- **Settings** (`/settings`, Admins only) takes the connection key from the ServiceFlow site
  (wp-admin → Settings → Orion). On save, Orion checks the `sfk1_` format, verifies the key
  with a signed `GET /connection`, and only then stores it, encrypted (AES-256-GCM under
  `ORION_ENCRYPTION_KEY`). A key that fails verification is not saved, so a working
  connection is never replaced by a broken one; the error shows the API's code.
- The key is never sent back to the browser. Settings shows only that one is set, the
  connection ID, and the site's live status (name, plugin and API versions, whether account
  linking is available), checked on every visit.
- With no key, every page still loads and shows a notice pointing Admins to Settings (D4).
- If `ORION_ENCRYPTION_KEY` changes, the stored key can't be decrypted; Settings says so, and
  the key has to be pasted again.
- The API client (`src/serviceflow/`) signs every request per the contract §2, maps every §4
  error code, re-signs once on clock skew, never follows redirects, and returns
  `X-SF-Server-Time` with each response for polling.
