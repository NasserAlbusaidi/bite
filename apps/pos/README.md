# @bite/pos

One React + Capacitor app for the till (POS) and the kitchen display (KDS).
The mode is picked per tablet and stored locally.

## Offline model

- Every write the tablet makes goes into local SQLite **and** the `outbox`
  table in the same transaction (`enqueue(tx, ...)`). Never write one without
  the other.
- Ids are UUIDv7 made on the device (`newId()`). The outbox row id is also the
  idempotency key, so replaying after a lost response is safe.
- `Replayer.flush()` pushes the outbox to `POST /v1/sync/push`:
  - strict FIFO; a network/auth failure stops the queue and backs off
    (2s, 4s, ... capped at 60s), nothing is dropped
  - `applied` / `duplicate` = done
  - `rejected` / `conflict` = parked with the error; every later mutation for
    the same `entityId` (order id, cash session id, product id) is parked as
    `blocked`, other entities keep flowing
- `entityId` is the aggregate: the order id for all `order.*` kinds, payments
  included.
- `memberId` on each mutation is whoever was logged in when it was queued.
- Ticket numbers are `<device prefix>-<seq>` per business day, allocated in
  the order's transaction.

## Pricing

The tablet never prices on its own. It calls `@bite/core` (same functions the
server uses to re-check `expectedTotals`). `src/domain/pricing-port.ts` is a
temporary type port until core publishes `priceLines()`.

## Printing

`PrintService` routes a `Ticket` to every printer configured on this device
for a role (`receipt`, `kitchen`). It never throws into the sale flow.

- ASCII tickets go out as ESC/POS text.
- Anything with Arabic is drawn on a canvas by the web view (proper shaping
  and RTL) and sent as an ESC/POS raster image.
- Transports: `console` (dev), `tcp` through `NativePrinterBridge`
  (implemented for both platforms), `bluetooth` not yet.
- Printing is local (LAN/Bluetooth), so it works with the internet down. This
  replaces the legacy single global PrintNode printer.

## Storage drivers

- Tablet: `@capacitor-community/sqlite` (durable, Android and iOS)
- Browser dev and tests: `sql.js` (in memory, gone on reload)

## Commands

`pnpm dev` (browser), `pnpm test`, `pnpm typecheck`, `pnpm build`.

## Native (Android and iPad, both supported)

- `android/` and `ios/` are Capacitor projects. After changing web code or
  plugins: `pnpm build && pnpm exec cap sync`. CI builds both
  (`.github/workflows/pos-native.yml`): Android `assembleDebug`, iOS simulator.
- `plugins/printer-socket` is our own small Capacitor plugin: raw TCP to
  port 9100 printers, Java on Android, Network.framework on iOS.
- iOS asks for Local Network permission the first time it prints
  (`NSLocalNetworkUsageDescription`).
- Recommended printers: network (LAN) ESC/POS. They work with both tablet
  types. Bluetooth is per platform (Classic on Android, BLE/MFi on iPad) and
  not wired yet.
