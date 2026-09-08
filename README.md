# SecurIoT Cloud API

NestJS + TypeORM Cloud API for SecurIoT Phase 1: JWT auth, an idempotent telemetry ingest endpoint, a filterable telemetry history endpoint, and Swagger/OpenAPI docs.

## Prerequisites

- Node.js 20+ (tested on Node 24)
- PostgreSQL (recommended), or no database install at all if you use the SQLite fallback described below

## Environment variables

Create a `.env` file in the project root (see the reference below for all variables). `.env` is git-ignored and must never be committed.

```
# Database driver: "postgres" (default, production) or "sqlite" (local dev fallback, no Postgres install required)
DB_DRIVER=postgres

# Used only when DB_DRIVER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=securiot

# Used only when DB_DRIVER=sqlite
DB_SQLITE_PATH=./data/securiot.sqlite

# JWT
JWT_SECRET=change-me-in-every-environment
JWT_EXPIRES_IN=1h

# Seed script (npm run seed) - creates one hardcoded test user
SEED_USER_EMAIL=test@securiot.local
SEED_USER_PASSWORD=ChangeMe123!

# Seed script also creates one hardcoded Zone + Device.
# The Device's apiKey is generated at seed time and printed to the console -
# copy it here so the device simulator (Edge API) can authenticate.
SEED_DEVICE_API_KEY=

PORT=3000
```

If you don't have Postgres installed locally, set `DB_DRIVER=sqlite` and `DB_SQLITE_PATH` to any local file path (e.g. `./data/securiot.sqlite`) - no server setup required.

## Setup

```bash
npm install
npm run seed
npm run start
```

`npm run seed` creates:
- One test user (`SEED_USER_EMAIL` / `SEED_USER_PASSWORD`)
- One Zone ("Front Entrance")
- One Device ("Front Door Sensor") linked to that Zone, with a freshly generated API key printed to the console - copy it into `SEED_DEVICE_API_KEY` for the Edge relay / device simulator to use

The API listens on `http://localhost:3000` (or `PORT` if set).

## API docs

Swagger/OpenAPI UI is served at `http://localhost:3000/api/docs`, covering both the auth and telemetry endpoints, including error responses (401 on both guards, 400 on validation failures).

## Endpoints

- `POST /api/v1/auth/login` - email/password login, returns `{ access_token }` (JWT, 1h expiry)
- `POST /api/v1/telemetry` - ingest a reading, guarded by the `X-Device-Key` header (device API key, not a user JWT). Idempotent on `reading_id`: retried POSTs with the same `reading_id` never create a second row.
- `GET /api/v1/telemetry` - list readings, guarded by a JWT (`Authorization: Bearer <token>`), filterable via `device_id`, `zone_id`, `from`, `to` query params.

## Testing

```bash
npm run test:e2e
```

The e2e suite spins up the full Nest app against an in-memory SQLite database and covers: idempotent ingest, the device-key guard, the JWT guard, and query filtering by device/zone.

## Scope

Zone/Device CRUD is out of scope for this phase (Phase 2) - the seeded Zone/Device are hardcoded records with no management endpoints.
