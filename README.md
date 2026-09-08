# SecurIoT Cloud API

NestJS + TypeORM Cloud API for SecurIoT: JWT auth, zones, devices, an idempotent telemetry ingest endpoint, alert generation, and Swagger/OpenAPI docs.

## Where this runs

This service runs centrally, on a VPS or any always-on host reachable from
the internet, since the Web App and Mobile App both talk to it directly over
HTTPS from wherever their users are. It is the only piece of SecurIoT meant
to be public-facing.

It is not where camera detection (YOLO) runs, that happens on the Edge API,
one instance per installation site, on the same LAN as that site's
ESP32-CAM. See `repos/securiot-edge-api/README.md`, "Where this runs", for
why. Each Edge API instance talks to this Cloud API as an outbound HTTPS
client (the relay), using `CLOUD_DEVICE_API_KEY`, the same way any device
does, this service never opens a connection back to an Edge API.

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

# Device online/offline window: a device is "online" if it has a Reading
# within this many seconds. Optional, defaults to 300 if unset.
DEVICE_ONLINE_WINDOW_SECONDS=300
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

All endpoints below live under `/api/v1`. Everything except `POST /auth/login` and telemetry ingest is guarded by a JWT (`Authorization: Bearer <token>`); telemetry ingest is guarded by `X-Device-Key` instead (device API key, not a user JWT).

- `POST /auth/login` - email/password login, returns `{ access_token }` (JWT, 1h expiry)
- `POST /zones`, `GET /zones`, `GET /zones/:id`, `PATCH /zones/:id`, `DELETE /zones/:id` - zones owned by the authenticated user
- `POST /devices`, `GET /devices`, `GET /devices/:id` - devices, each linked to one of the user's zones; the create response is the only place the device's `apiKey` is ever shown in full
- `POST /telemetry` - ingest a reading, guarded by `X-Device-Key`. Idempotent on `reading_id`: retried POSTs with the same `reading_id` never create a second row
- `GET /telemetry` - list readings, filterable via `device_id`, `zone_id`, `from`, `to` query params
- `GET /alerts` - list alerts for the user's zones, filterable via `zone_id`, `device_id`, `status`; generated automatically from telemetry (see "Scope" below)

## Testing

```bash
npm run test:e2e
```

The e2e suite spins up the full Nest app against an in-memory SQLite database and covers: idempotent ingest, the device-key guard, the JWT guard, and query filtering by device/zone.

## Scope

Alert rules are intentionally minimal: `AlertsService.evaluateRule` currently fires one rule, `door_contact_open` (a `door_contact` reading with value `open` creates a `medium` severity alert), triggered inline every time `POST /telemetry` ingests a matching reading. Adding a new rule means adding a branch there, no separate rules engine.
