# Bite (TypeScript rewrite)

Legacy app: `NasserAlbusaidi/pos-system` (Laravel). It stays in production until cutover. It is the spec: its tests and `GuestOrderService` pricing define correct behaviour.

## Layout

- `apps/api` Hono API (Node 22)
- `apps/pos` React + Vite + Capacitor POS and KDS, offline with a local SQLite outbox. Read `apps/pos/README.md` first.
- `apps/menu` SSR guest menu + group carts (React Router framework mode). With `BITE_API_URL` unset it runs on in-memory fixtures (`app/lib/fixtures.server.ts`). The bare domain (`/`, `/ar`) is Bite's own public page; `BITE_ADMIN_URL` is the back office address its sign-up and log-in buttons point at (unset = no buttons). Behind a TLS proxy set `BITE_MENU_ACTION_HOSTS` (public host, build time) or checkout fails with a bare 400 from the CSRF check.
- `apps/admin` back office SPA (React Router, `ssr: false`) on the `/v1/admin` contracts. With `VITE_API_URL` unset it runs on in-browser demo data (`app/lib/fixtures.ts`, saved to localStorage). With it set, sign-in is Better Auth on the API: the API's `ADMIN_ORIGINS` must list the admin origin, and admin + API should share a site (admin.bite.om / api.bite.om) so the session cookie works without SameSite=None. `VITE_MENU_URL` is the guest menu's public address (for the printable QR); `VITE_PAIRING_API_URL` overrides the API address in the tablet pairing QR (dev only).
- `packages/core` pure TS, zero runtime deps: money, pricing, VAT, order state machine. Runs on the server AND offline on the tablet.
- `packages/db` Drizzle schema, migrations, RLS policies. Read `docs/data-model.md` before touching it.
- `packages/contracts` Zod schemas shared by API and clients (not yet scaffolded)
- Plans and limits (freemium): `docs/plans.md`. Tier boundaries live only in `packages/core/src/plans.ts`. Enforcement is off unless the API has `PLAN_ENFORCEMENT=on`.
- `packages/ui` design system: tokens, fonts, React components, RTL-first. Read `packages/ui/README.md` before styling any app. Apps style with semantic tokens only.

## Non-negotiable rules

- Money is integer minor units (baisa). Never floats. Rates are integer basis points. Use `@bite/core` money helpers; rounding is half away from zero.
- Pricing must match the legacy app to the baisa (parity harness).
- Every tenant-scoped endpoint gets a cross-tenant test.
- Postgres RLS: the app connects as a non-owner role and sets the tenant per transaction.
- Drizzle migrations are reviewed by hand.
- Money, tenancy and auth changes are reviewed and merged by Nasser personally.

## Commands

`pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`.
