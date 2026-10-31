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

# Password reset by email (Resend). Plain REST, no SDK.
# Resend API key. Leave empty for dev mode: nothing is sent and, by default, nothing
# sensitive is logged. Never commit a real key.
RESEND_API_KEY=
# Dev mode only (RESEND_API_KEY empty): set to 1 to log the full email, including the
# reset link, at WARN. Off by default so a link never ends up in logs by accident.
MAIL_DEV_LOG=
# Sender. The Resend sandbox sender only delivers to the Resend account owner address.
RESEND_FROM=onboarding@resend.dev
# Mailbox that receives every password reset link, because the seeded login
# test@securiot.local is not a real mailbox. It must equal the Resend account email while
# the sandbox sender is used. When unset the reset email is disabled.
# The same address also receives a short email whenever the alerts engine creates a new alert
# (throttled to one per device and alert type per 10 minutes). Nothing is sent when unset.
ADMIN_EMAIL=juancarlosanguloabud@gmail.com
# Base URL of the Web App used to build the reset link. http or https only, no credentials.
WEB_APP_URL=http://localhost:4200
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

All endpoints below live under `/api/v1`. Everything except `POST /auth/login`, the two password reset endpoints and telemetry ingest is guarded by a JWT (`Authorization: Bearer <token>`); telemetry ingest is guarded by `X-Device-Key` instead (device API key, not a user JWT).

- `POST /auth/login` - email/password login, returns `{ access_token }` (JWT, 1h expiry)
- `POST /auth/forgot-password` - body `{ email }`, always answers `202` with the same body whether or not the account exists; the reset link goes to `ADMIN_EMAIL`, not to the account holder
- `POST /auth/reset-password` - body `{ token, newPassword }`, answers `200`, or `400` with `code: invalid_reset_token` for any unknown, expired or used token; the new password needs at least 10 characters and at most 72 bytes
- `POST /zones`, `GET /zones`, `GET /zones/:id`, `PATCH /zones/:id`, `DELETE /zones/:id` - zones owned by the authenticated user
- `POST /devices`, `GET /devices`, `GET /devices/:id` - devices, each linked to one of the user's zones; the create response is the only place the device's `apiKey` is ever shown in full
- `POST /telemetry` - ingest a reading, guarded by `X-Device-Key`. Idempotent on `reading_id`: retried POSTs with the same `reading_id` never create a second row
- `GET /telemetry` - list readings, filterable via `device_id`, `zone_id`, `from`, `to` query params
- `GET /alerts` - list alerts for the user's zones, filterable via `zone_id`, `device_id`, `status`; generated automatically from telemetry (see "Scope" below)

## Password reset (admin-mediated)

The seeded login `test@securiot.local` has no real mailbox, so every reset link is sent to `ADMIN_EMAIL`, never to the account holder. The administrator forwards the link only to the owner of the account.

- The link is `WEB_APP_URL/reset-password?token=...`, lasts 30 minutes and works once. Requesting a new link invalidates the older ones.
- Only the SHA-256 hash of the token is stored (table `password_reset_tokens`, created by DB sync on the next start). The raw token exists only in the email.
- `WEB_APP_URL` is the only source of the link host. Request headers (`Host`, `Origin`, `X-Forwarded-*`) are never used.
- Mail goes through the Resend REST API (`RESEND_API_KEY`, `RESEND_FROM`). A mail failure never fails the request. While the sandbox sender `onboarding@resend.dev` is used, Resend only delivers to the Resend account owner, so `ADMIN_EMAIL` must be that address.
- With `RESEND_API_KEY` unset (dev mode) nothing is sent and only the subject is logged at WARN. To see the reset link in the log, also set `MAIL_DEV_LOG=1`. This does not depend on `NODE_ENV`, and the link is never logged otherwise.
- Rate limits are in memory and per process: `forgot-password` allows 5 requests per 15 minutes per IP and per email, `reset-password` 10 per 15 minutes per IP. Excess requests get `429` with `Retry-After`. The counters are lost on restart, and behind a reverse proxy every client shares the proxy address because Express `trust proxy` is not enabled.
- Old JWTs are not revoked: there is no revocation list, so a token issued before a reset stays valid until `JWT_EXPIRES_IN` elapses (1h by default).

## Admin email notifications

When the alerts engine creates a new alert, the Cloud sends a short plain-text email in Spanish to `ADMIN_EMAIL`. It covers two events:

- A `rule_alert` reading that becomes an alert (the Edge rules engine fired a rule).
- A device going offline (the cron sweep creates the `device_offline` alert).

The email carries only the alert type, severity, message, device id, zone id and a link to the Web alerts page (`WEB_APP_URL/alerts`). It never includes any key or secret.

- Throttle: at most one email per device and alert type every 10 minutes. The throttle is in memory and per process, so it resets on restart. A replayed reading (same `reading_id`) creates no second alert and no email.
- Sending is asynchronous. A Resend failure, a timeout or a hang never affects telemetry ingest or the offline cron.
- With `RESEND_API_KEY` unset (dev mode) the email is not sent and only the subject is logged at WARN (the body too when `MAIL_DEV_LOG=1`).
- With `ADMIN_EMAIL` unset or blank nothing is sent. The alert is still created as usual.
- While the sandbox sender `onboarding@resend.dev` is used, `ADMIN_EMAIL` must be the Resend account address.

## Testing

```bash
npm run test:e2e
```

The e2e suite spins up the full Nest app against an in-memory SQLite database and covers: idempotent ingest, the device-key guard, the JWT guard, and query filtering by device/zone.

## Scope

Alert rules are intentionally minimal: `AlertsService.evaluateRule` currently fires one rule, `door_contact_open` (a `door_contact` reading with value `open` creates a `medium` severity alert), triggered inline every time `POST /telemetry` ingests a matching reading. Adding a new rule means adding a branch there, no separate rules engine.
