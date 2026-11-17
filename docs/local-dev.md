# Local development

Runs the API, back office, guest menu and POS/KDS against a local Postgres
with a seeded demo org.

## Needs

- Node 22 (`.nvmrc`) and pnpm (`corepack enable`, or `corepack pnpm ...`)
- Docker for Postgres (Docker Desktop, or Docker inside WSL). Any Postgres 16
  works: set `DATABASE_OWNER_URL` to a superuser URL before `dev:setup`.

## First run

```sh
pnpm install
pnpm db:up        # Postgres 16 on 127.0.0.1:5432 (docker-compose.yml)
pnpm dev:setup    # env files, roles, migrations, demo seed; prints credentials
pnpm dev:all      # api :3000, admin :5173, menu :5174, pos :5175 (https)
```

`dev:setup` is idempotent. It keeps existing `.env` files and skips the seed
when the demo location exists. URLs, the owner login, device tokens and staff
PINs go to `.dev-credentials.txt` (gitignored). To start over:
`docker compose down -v`, delete `apps/api/.env`, run `dev:setup` again.

## How the pieces connect

- The API connects as `bite_api` (in `bite_app`, RLS on). The worker
  (`pnpm --filter @bite/api worker`) connects as `bite_worker` (`bite_system`).
  Migrations run as the `postgres` superuser.
- The admin and POS dev servers proxy `/v1` to the API. The admin uses
  `VITE_API_URL=/`, so sign-in is same-origin and the session cookie works on
  localhost and on a LAN IP. `ADMIN_ORIGINS` lists `http://localhost:5173`
  and the LAN IPs found at setup time; re-run setup after deleting
  `apps/api/.env` if your IP changes.
- The menu SSR server calls the API directly (`BITE_API_URL` in `apps/menu/.env`).
  Guest menu: `http://localhost:5174/demo-cafe`.

## POS on a tablet (same Wi-Fi)

The POS dev server is HTTPS with a self-signed certificate. Browsers expose
`crypto.subtle` (offline PIN unlock) only on HTTPS or localhost.

1. Open `https://<PC LAN IP>:5175` on the tablet and accept the warning.
2. Pair with server address = that same URL, and the POS (or KDS) token from
   `.dev-credentials.txt`.
3. Pick a staff member and type the PIN.

The browser build stores data in memory (sql.js): a reload loses unsynced
local data. The native Capacitor build uses SQLite.
