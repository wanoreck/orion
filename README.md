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

## Deployment

Coolify builds the `Dockerfile` on every push to `main` and runs it on port 3000. Set these
environment variables in Coolify (see `.env.example`):

- `DATABASE_URL`: Orion's Postgres database (a Coolify database service).
- `ORION_ENCRYPTION_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`).

If the database can't be reached at startup, the container exits and Docker restarts it.
