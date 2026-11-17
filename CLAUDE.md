# Bite (TypeScript rewrite)

Legacy app: `NasserAlbusaidi/pos-system` (Laravel). It stays in production until cutover. It is the spec: its tests and `GuestOrderService` pricing define correct behaviour.

## Layout

- `apps/api` Hono API (Node 22)
- `apps/pos` React + Vite + Capacitor POS and KDS, offline with a local SQLite outbox. Read `apps/pos/README.md` first.
- `apps/menu` SSR guest menu (not yet scaffolded)
- `apps/admin` back office (not yet scaffolded)
- `packages/core` pure TS, zero runtime deps: money, pricing, VAT, order state machine. Runs on the server AND offline on the tablet.
- `packages/db` Drizzle schema, migrations, RLS policies. Read `docs/data-model.md` before touching it.
- `packages/contracts` Zod schemas shared by API and clients (not yet scaffolded)

## Non-negotiable rules

- Money is integer minor units (baisa). Never floats. Rates are integer basis points. Use `@bite/core` money helpers; rounding is half away from zero.
- Pricing must match the legacy app to the baisa (parity harness).
- Every tenant-scoped endpoint gets a cross-tenant test.
- Postgres RLS: the app connects as a non-owner role and sets the tenant per transaction.
- Drizzle migrations are reviewed by hand.
- Money, tenancy and auth changes are reviewed and merged by Nasser personally.

## Commands

`pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`.
