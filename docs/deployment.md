# ATS production deployment

This project is deployed as a mixed static frontend + FastAPI backend stack behind Caddy.

## Runtime contract

- Frontend build output: `dist/`
- Backend upstream: `127.0.0.1:8000`
- Public host: `PUBLIC_HOST` (for example `ats.34.21.188.225.nip.io`)
- Caddy config: `infra/caddy/Caddyfile`
- Log file: `LOG_FILE`

The public site must be served over HTTPS only. Caddy handles the certificate, HTTP -> HTTPS redirect, and security headers.

## Recommended deployment flow

1. Install dependencies and build the frontend.
   ```bash
   npm ci
   npm run build
   ```

2. Start the backend on loopback only.
   The backend must listen on `127.0.0.1:8000` so only Caddy can reach it.

   Example launcher:
   ```bash
   PYTHONPATH=. python3 - <<'PY'
   from pathlib import Path

   import uvicorn

   from apps.api.app.main import create_app

   app = create_app(db_path=Path('.ats.sqlite3'), upload_dir=Path('uploads'), seed_demo_data=True)
   uvicorn.run(app, host='127.0.0.1', port=8000, log_level='info')
   PY
   ```

3. Export the Caddy environment.
   ```bash
   export PUBLIC_HOST="ats.34.21.188.225.nip.io"
   export API_UPSTREAM="127.0.0.1:8000"
   export WEB_ROOT="/home/weihao95/workspace/ATS/dist"
   export LOG_FILE="/var/log/caddy/ats.log"
   ```

4. Validate the Caddyfile before launching.
   ```bash
   sudo caddy fmt --overwrite infra/caddy/Caddyfile
   sudo -E caddy validate --config infra/caddy/Caddyfile --adapter caddyfile
   ```

5. Stop any system Caddy service and start the dedicated instance.
   ```bash
   sudo systemctl stop caddy 2>/dev/null || true
   sudo systemctl disable caddy 2>/dev/null || true
   sudo -E caddy run --config infra/caddy/Caddyfile --adapter caddyfile
   ```

6. Run the smoke test.
   ```bash
   PUBLIC_HOST="$PUBLIC_HOST" ./scripts/caddy_smoke_test.sh
   ```

## What Caddy routes

- `/` and all SPA paths -> static `dist/` files
- `/api/*` -> backend with the `/api/` prefix stripped
- `/health` and `/version` -> backend health/version endpoints

The `/api/*` route is what the frontend uses for event polling and SSE.
The direct `/health` route is the deployment health probe.

## Rollback

If the release misbehaves:

1. Stop Caddy.
2. Restore the previous `dist/` artifact or backend build.
3. Re-run the smoke script against the previous release.
4. Re-enable the prior Caddyfile or previous upstream process.

## Safety checks before go-live

- Confirm ports 80 and 443 are open in the cloud firewall.
- Confirm the backend only binds to loopback.
- Confirm `dist/` was generated from the current source.
- Confirm `/health` and `/api/health` both return 200.
- Confirm a deep SPA route such as `/dashboard` still returns the built shell.
