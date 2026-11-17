# `@bite/core` public API

Pure TypeScript, zero runtime deps, synchronous. The same calls run on the API, offline on the POS tablet, and in the guest's browser. Core never reads the clock or the database: callers pass everything in.

**The server re-prices every order with these functions and rejects totals that don't match.** Clients must not compute money any other way.

Everything is exported from `@bite/core`. Money is `Minor` (integer baisa), rates are `BasisPoints` (5% = 500). Rounding is half away from zero.

## Pricing

```ts
priceLines(lines: LineInput[], ctx: PricingContext): Result<PricedOrder>
priceCart(cart: CartLine[], catalog: Catalog, ctx: PricingContext): Result<PricedOrder>
resolveCart(cart: CartLine[], catalog: Catalog): Result<LineInput[]>
buildCatalog(products /* with modifierGroupIds */, modifierGroups): Catalog
promotedUnitPrice(product, promotions, at, locationId?): { unitPrice, listUnitPrice, promotionId }
lineTax(amount, rate, pricesIncludeTax): Minor
DEFAULT_LIMITS // 50 lines, 99 per line, 1000.000 OMR total (legacy config)
```

- **`priceLines`**: lines are already resolved (the POS has the catalog). Each `LineInput` carries `productId`, `categoryId`, `name`, `quantity`, `listUnitPrice`, `taxBps | null`, `modifiers: { groupId, optionId, name, priceDelta }[]`, `note?`.
- **`priceCart`**: for untrusted carts (guest menu, group carts, API). Takes ids only, validates against the live catalog (unknown/86'd product, unknown/duplicate/86'd modifier, group min/max), then calls `priceLines`. It returns every error at once, each with `lineIndex`, so the UI can flag all bad lines.
- **`buildCatalog`** takes the flat `MenuSnapshot` shape from `@bite/contracts` (products with `modifierGroupIds`, plus a list of groups).
- `PricingContext = { settings: { pricesIncludeTax, taxBps, locationId?, taxMode?, limits? }, promotions, at: LocalClock }`.
- `Result<T> = { ok: true, value: T } | { ok: false, errors: PricingError[] }`. Error codes: `empty_cart`, `too_many_lines`, `invalid_quantity`, `quantity_too_large`, `invalid_price`, `total_too_large`, `legacy_mode_requires_exclusive`, `unknown_product`, `product_unavailable`, `invalid_modifier`, `duplicate_modifier`, `modifier_unavailable`, `modifier_below_min`, `modifier_above_max`.

### Output maps 1:1 onto the tables

| `PricedLine`                        | `order_lines`     | Meaning                                                         |
| ----------------------------------- | ----------------- | --------------------------------------------------------------- |
| `listUnitPrice`                     | `list_unit_price` | Menu price before promotion                                     |
| `unitPrice`                         | `unit_price`      | After promotion, before modifiers                               |
| `promotionId`                       | `promotion_id`    | The one promotion applied, or null                              |
| `modifiers`                         | `modifiers`       | Snapshot, in menu order                                         |
| `taxBps`                            | `tax_bps`         | Resolved rate (product override, else location)                 |
| `lineTotal`                         | `line_total`      | `max(0, unitPrice + Σ deltas) × qty`, gross or net per tax mode |
| `lineDiscount`                      | `line_discount`   | What the promotion saved (already out of `lineTotal`)           |
| `lineTax`                           | `line_tax`        | VAT on this line                                                |
| `unitTotal`, `lineNet`, `lineGross` | not stored        | Display helpers                                                 |

| `PricedOrder`                                                         | `orders`             |
| --------------------------------------------------------------------- | -------------------- |
| `pricesIncludeTax`                                                    | `prices_include_tax` |
| `subtotal` = Σ `lineTotal`                                            | `subtotal`           |
| `discountTotal` = Σ `lineDiscount`                                    | `discount_total`     |
| `taxTotal` = Σ `lineTax`                                              | `tax_total`          |
| `total` = `subtotal + taxTotal` (exclusive) or `subtotal` (inclusive) | `total`              |

Invariant (tested): Σ `lineGross` = `total` and Σ `lineNet` + `taxTotal` = `total`, in every mode.

### Rules

- **Promotions**: at most one per line, never stacked. Winner: highest `priority`, then most specific target (product > category > whole menu), then smallest `id`. With equal priorities this is exactly the legacy precedence. A promotion applies to the base price only, never to modifiers. Open items (`productId: null`) never get one.
- Percent promotions round the **resulting price**, not the discount, as legacy `PricingRule::applyTo` does (`round(price − price × pct)`); the two differ by 1 baisa on exact halves.
- **Daily windows** are inclusive at both ends (legacy). A window that wraps midnight (22:00–02:00) belongs to the weekday it opened, so a Thursday-night promo still applies at 01:00 on Friday. `startsAt`/`endsAt` accept epoch ms or ISO strings; start is inclusive, end exclusive.
- **Modifiers** may be negative; the unit total is floored at 0 (legacy).
- **VAT**: `taxBps` on the product overrides the location rate, and **0 is an override** (legacy `??` semantics). In `per_line` mode (the default) tax is rounded per line. Exclusive prices: `applyRate`. Inclusive: `taxFromInclusive`.
- **`taxMode: "legacy"`** reproduces Laravel: exclusive only, the order tax is rounded once over the unrounded sum, then allocated back to lines (largest remainder) so the per-line column still adds up. Use it only for parity and migration, not for new orders.

### Combos

There is no combo table, and I didn't add one. A combo is a product (a "Burger meal" at 3.500) with required modifier groups ("Choose a drink", min 1, max 1), where upgrades carry a `priceDelta`. That already prices, validates and snapshots correctly. Auto-detecting bundles (adding burger + fries + drink makes it a meal) is not supported, because it fights "one promotion, no stacking". Raise it if a customer needs it.

## Clock

```ts
localClock(epochMs, timeZone): LocalClock   // { epochMs, date: "YYYY-MM-DD", weekday 0=Sun, secondOfDay }
clockAt(date, "HH:MM[:SS]", epochMs?): LocalClock
businessDate(epochMs, timeZone, dayCutoffMinutes): string
addDays(date, n), parseTimeOfDay("HH:MM[:SS]")
```

Uses `Intl` only. `businessDate`: with a 240 cutoff, 01:30 on the 18th belongs to the 17th.

## Order status

```ts
FULFILLMENT_STATUSES, PAYMENT_STATUSES
canTransition(from, to): boolean                       // graph only
fulfillmentTransitions(from): FulfillmentStatus[]
checkFulfillmentTransition(from, to, paymentStatus, policy?) // { ok } | { ok: false, error }
paymentStatusFor(total, paid, refunded): PaymentStatus
```

- Graph: `pending → preparing → ready → completed`. Forward skips are allowed (a counter sale can go straight to `completed`). `ready → preparing` (KDS recall) is the only backward move. Anything but `completed` can go to `cancelled`. `completed` and `cancelled` are terminal.
- Errors: `not_allowed`; `refund_first` (cancelling while money is held, matching legacy `canCancelWithoutPaymentReversal`); `unpaid` (completing an unsettled bill, or starting the kitchen on an unpaid order).
- `policy.kitchenRequiresPayment` defaults to **true**, because the legacy KDS only showed paid orders. Turn it off for pay-at-the-end dine-in.
- `payment_status` is **derived from the ledger, never set**: unpaid, partially_paid, paid, then partially_refunded/refunded once any refund exists. A zero-total order is `paid`.

## Payments, splits and refunds

```ts
summarizePayments(total, entries: LedgerEntry[]): PaymentSummary
checkTender(summary, { amount, method, tendered? }): { ok, change } | { ok: false, error }
refundableAmount(paymentId, entries): Minor
planRefund(amount, entries): RefundPart[] | null
lineRefundAmount({ lineGross, quantity }, qty, alreadyRefunded?): Minor
splitEqually(amount, n): Minor[]
allocate(total, weights): Minor[]
cashChange(amount, tendered): Minor
```

- `LedgerEntry = { id, amount, method, state, reversesPaymentId? }`, the same as a `payments` row. Tips are separate and excluded.
- `PaymentSummary`: `paid`, `refunded`, `net` (= `orders.paid_total`), `pending`, `balanceDue`, `chargeable` (balance minus in-flight pending payments), `status`.
- `checkTender` blocks overpayment, **counting pending payments**, so a Thawani payment in flight plus a cash tender can't double-charge. Only cash can be over-tendered; it returns the change.
- `planRefund` refunds the newest payment first, each back to its own method, and returns ready-to-insert negative rows. It returns null if you ask for more than is refundable (pending refunds count as used).
- `lineRefundAmount` rounds cumulatively, so refunding a line one unit at a time adds up to exactly its gross.
- `allocate` is the largest-remainder split behind all of this. Parts always add up to the total exactly, and ties go to the earlier index. Use it for "split by seat" or "split by item" too.

## Known differences from legacy (by design)

1. **No discount stacking.** Legacy applied the product sale discount, then a pricing rule on top of that. Migration turns both into promotions, and only one applies. A product that was on sale AND under a pricing rule will price differently. The parity harness flags these.
2. Legacy stored `price_snapshot` including modifiers; new `unit_price` excludes them (`unitTotal` is the old value).
3. Legacy rounded tax once per order; new orders round per line. Expect ±1 baisa per order versus legacy on multi-line orders. `taxMode: "legacy"` is exact.
4. Legacy daily windows could not wrap midnight; new ones can.
5. Legacy rates were decimal percent with 3 places (5.125%); bps can't hold half a basis point. Migration must reject or flag any rate that isn't a whole number of bps.
