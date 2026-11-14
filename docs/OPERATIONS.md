# Operations: deploy, CI/CD, device keys

## Environments

The API runs on Dokploy (Docker, built from the `develop` branch) behind
Cloudflare. All routes live under `/api/v1` (for example `GET /api/v1/devices`).

## GitFlow

| Branch | Purpose |
| --- | --- |
| `main` | Released code |
| `develop` | Integration branch. Pushes here deploy to Dokploy |
| `feat/*`, `fix/*`, `docs/*`, `chore/*` | Branch from `develop`, merge back with a pull request |

`main` and `develop` require a pull request and a green `lint-test-build` check.
Release with a pull request from `develop` into `main`.

## CI (`.github/workflows/ci.yml`)

Node 22: `npm ci`, unit tests, e2e tests (`npm run test:e2e`), `npm run build`,
then `docker build` to prove the image builds. Run `npm test`,
`npm run test:e2e` and `npm run build` locally first.

Keep `package-lock.json` generated with Node 22 and npm 10. The Docker image uses
`npm ci`, which fails if a lockfile from a newer npm is out of sync. If it does:

```bash
docker run --rm -v "$PWD":/app -w /app node:22 npm install --package-lock-only
```

## CD (`.github/workflows/cd.yml`)

On every push to `develop` the workflow posts to the Dokploy webhook stored in
the repository secret `DOKPLOY_DEPLOY_HOOK`. Dokploy ignores the call unless it
looks like a GitHub push, so the request must carry the header
`X-GitHub-Event: push` and a body with `ref: refs/heads/develop`. The workflow
already does both. To redeploy by hand, call the Dokploy API
`POST /api/application.deploy` with the application id.

## Environment variables

See the README table for the full list. The ones that tie the system together:

| Variable | Meaning |
| --- | --- |
| `EDGE_DEVICE_SHARED_SECRET` | Device key the Setup QR hands to the board. Must equal the Edge `DEVICE_SHARED_SECRET` |
| `EDGE_ADMIN_API_KEY` | Admin key the API sends to the Edge (`X-Admin-Key`) for the live feed, face enrollment and manual commands. Must equal the Edge value |

Set them in Dokploy, then redeploy. Never log or commit them.

## Device keys

Each device has its own `apiKey`, used by the Edge as `X-Device-Key` on
`/telemetry` and heartbeats. A wrong key returns 401 and the Web App shows the
device offline. To issue a new one, the device owner calls:

```
POST /api/v1/devices/:id/rotate-key      (Bearer JWT, owner only)
```

The response includes the new `apiKey` once. The old key stops working at once.
Put the new key in the Edge `CLOUD_DEVICE_API_KEY` and restart the Edge.

## Edge URL

`PATCH /api/v1/devices/:id` with `{ "edgeUrl": "https://..." }` sets where the
API reaches the Edge. The server calls it from the VPS, so it must be a public
address (a Cloudflare tunnel hostname), not a LAN IP. Loopback and link local
hosts are rejected. The Setup QR reuses this value for the board, so the board
posts to the same URL unless you provision it with a LAN address.
See the Edge repo `docs/LOCAL_DEPLOYMENT.md`.

## Billing (simulated gateway)

The `billing` module is a classroom simulation. **Nothing is ever charged.** No payment processor is called and no
real card is processed. The `PaymentGatewaySimulator` service only recognises the four test card numbers below. Any
other number, including a real card, is declined with `unknown_test_card`.

Endpoints, all under `/api/v1`:

| Endpoint | Auth | Result |
| --- | --- | --- |
| `GET /billing/plans` | none | `{ currency: "PEN", igvRate: 0.18, plans[] }` |
| `POST /billing/checkout` | JWT | `201 { payment, subscription }` approved, `402 { payment }` declined (no subscription), `409` if an active subscription exists (checked before charging), `400` on validation errors |
| `GET /billing/subscription` | JWT | `{ subscription \| null, payments[] }`, newest first, own data only |
| `POST /billing/subscription/cancel` | JWT | `200` with the canceled subscription, `404` if none |

The first charge is `cameras x (installFeePerCamera + monthlyPerCamera)` as subtotal, plus 18 percent IGV rounded to
2 decimals. Plans live in code (`src/billing/plans.ts`). Checkout body:
`{ planId: "basic" | "standard" | "plus", cameras: 1..8, card: { number, holder, expMonth, expYear, cvc } }`.

Test cards (spaces and dashes are ignored):

| Number | Outcome |
| --- | --- |
| `4242 4242 4242 4242` | Approved |
| `4000 0000 0000 0002` | Declined, `card_declined` |
| `4000 0000 0000 9995` | Declined, `insufficient_funds` |
| `4000 0000 0000 0069` | Declined, `expired_card` |
| anything else | Declined, `unknown_test_card` |

Card data: the number, the holder and the cvc are never stored and never logged. Only the brand (`visa`,
`mastercard`, `unknown`, by prefix) and the last 4 digits are saved, in the `payments` table. Subscriptions are in
`subscriptions`. Both tables are created by DB sync on the next start.

Latency: each charge waits a random 600 to 1200 ms to look like a real gateway. Set `BILLING_SIMULATED_LATENCY_MS`
to a fixed number of milliseconds to change it, or to `0` to disable it. The test setup (`test/setup-env.ts`) sets `0`.
