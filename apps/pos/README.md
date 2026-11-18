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

## Flow

Pair (server URL + device token from the back office, `GET /v1/device/me`)
→ lock screen (staff list, PIN) → till or kitchen display by `device.kind`.

- PIN login is online first. On success the tablet keeps a PBKDF2 verifier
  so the same person can unlock offline for 7 days. A server "wrong PIN"
  wipes it. Offline guessing locks for 5 minutes after 5 misses.
- `SyncEngine` pushes the outbox, then pulls (`/v1/sync/pull`) menu + orders
  every 5s and right after each sale.
- `commitSale` = one local transaction: ticket number, local order row,
  `order.create` + one `order.addPayment` per tender. Cash needs an open
  drawer session (`cash.open` is queued the same way).
- Receipt and kitchen tickets print after the sale is stored; print failures
  show on screen and never undo the sale.

## Pricing

The tablet never prices on its own. It calls `@bite/core` (same functions the
server uses to re-check `expectedTotals`): `priceLines`, `localClock`,
`businessDate`. See `docs/core-api.md`.

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

## Orders, refunds, drawer, sync problems

- **Ledger.** An order's payments are the server's rows (`Order.payments` on every pulled copy) plus this tablet's own rows in the local `payments` table that the server hasn't echoed back yet (`mergeLedger`). A local row whose own mutation was rejected never counts.
- **Refunds** go back to the methods the order was paid with, newest payment first (core `planRefund`), one `order.refund` per payment touched. They are queued under a manager's id: if the person at the till isn't a manager, a manager types their PIN on the spot. Cash refunds need this tablet's drawer open. "Refund item" on an open order also queues `order.voidLine` after the refund, because the server refuses to void a paid line first. Unpaid lines (QR orders waiting at the counter) can be voided by a cashier.
- **Paying an order that already exists.** QR and group orders arrive unpaid, and the kitchen won't start them until they are paid. The till shows how many are waiting; Orders → "To pay" lists them oldest first. "Take payment" queues `order.addPayment` (`payOrder`), then prints the receipt and, now that the kitchen can see it, the kitchen ticket. "Cancel order" (`cancelOrder`, `order.setFulfillment` → cancelled) works while no money is held; a paid order is refunded first.
- **Split bill.** The pay sheet takes a bill in parts, for a new sale or an existing order: equal shares for 2 to 5 guests (core `splitEqually`) or any amount per part, each cash or card. Parts are held in the sheet and queued together when nothing is left, one `order.addPayment` each, so a half-taken bill is never stored. Change is shown per cash part.
- **Drawer.** Pay in, pay out and safe drop are `cash.movement`. The X report (drawer open) and Z report (after the count) are computed from this tablet's own rows with the server's formula: float + cash payments and tips - cash refunds + pay ins - pay outs - drops. Both print on the receipt printer.
- **Sync problems.** The red badge opens them, grouped by record. A conflict (someone else changed it first) can be sent again under a new id. A real rejection can't: a manager fixes it by hand and sets it aside. It stays in the outbox for the record, stops blocking, and anything waiting behind it is sent on.

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
