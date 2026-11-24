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
- `apps/admin/.env.local` also sets `VITE_MENU_URL` (what the guest QR code
  opens) and `VITE_PAIRING_API_URL` (what the tablet pairing QR points at: the
  POS dev server's own https address, because that is the only way the POS
  page can reach the API in dev). An older `.env.local` won't have them: add
  `VITE_MENU_URL=http://localhost:5174` and
  `VITE_PAIRING_API_URL=https://localhost:5175` (or your LAN IP for a tablet).
- The menu SSR server calls the API directly (`BITE_API_URL` in `apps/menu/.env`).
  Guest menu: `http://localhost:5174/demo-cafe`.
- `http://localhost:5174/` (and `/ar`) is Bite's public page. Its sign-up and
  log-in buttons point at `BITE_ADMIN_URL` in `apps/menu/.env`; an older `.env`
  won't have it: add `BITE_ADMIN_URL=http://localhost:5173`. Unset, the page
  shows no buttons.

## POS on a tablet (same Wi-Fi)

The POS dev server is HTTPS with a self-signed certificate. Browsers expose
`crypto.subtle` (offline PIN unlock) only on HTTPS or localhost.

1. Open `https://<PC LAN IP>:5175` on the tablet and accept the warning.
2. Pair: in the back office open the location, add a device, and scan the
   pairing code it shows (or paste it). By hand: server address = that same
   URL, and the POS (or KDS) token from `.dev-credentials.txt`.
3. Pick a staff member and type the PIN.

The browser build stores data in memory (sql.js): a reload loses unsynced
local data. The native Capacitor build uses SQLite.

## Showcase data (Luban Café)

`pnpm dev:setup` seeds a tiny Demo Cafe. For a demo that looks like a real
business, with the API running:

```sh
pnpm --filter @bite/api demo:seed
```

It adds Luban Café: two Muscat branches (Qurum, Al Mouj), a 26-item
English/Arabic menu with options, three promotions, staff on both branches,
a till and a kitchen screen per branch, and three weeks of sales pushed
through the real sync endpoint (core pricing, cash sessions, card and cash).
Logins, tablet tokens and PINs go to `.demo-credentials.txt` (gitignored).

Run it again just before a demo: it keeps the tablet tokens (paired tablets
stay paired) and tops up today's sales to 20 minutes ago, so the overview
reads like a normal day so far. `DEMO_NEW_TOKENS=1` issues new tablet tokens.
`DEMO_API_URL` points it at an API that is not on port 3000.
