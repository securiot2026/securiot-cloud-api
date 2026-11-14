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
