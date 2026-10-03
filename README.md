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
