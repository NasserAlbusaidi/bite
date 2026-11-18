# Plans and entitlements

Bite is freemium: a free plan and two paid plans, charged per location. The
business reasoning, prices and open decisions are in the plan doc linked from
the PR that added this file. This page is how the code works.

## Where things live

| What                                                                | Where                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The plan catalog: features, limits, prices, trial and grace lengths | `packages/core/src/plans.ts`                                      |
| Wire schemas (`Entitlements`, `PlanLimitDetails`)                   | `packages/contracts/src/billing.ts`                               |
| Loading an org's entitlements, the limit guards                     | `apps/api/src/lib/entitlements.ts`                                |
| What an org has paid for                                            | `billing_subscriptions` rows                                      |
| Trial and hand-set exceptions                                       | `orgs.status`, `orgs.trial_ends_at`, `orgs.entitlement_overrides` |

To move a tier boundary or change a price, edit `PLANS` in `plans.ts`. Nothing
else hard-codes a plan name.

## The kill switch

`PLAN_ENFORCEMENT=on` on the API turns enforcement on. Anything else (the
default) means every org gets every feature, unlimited, and the entitlement
code touches no tables. Leave it off until the free plan launches.

## How an org's plan is resolved

`resolveEntitlements` in core takes the best of:

1. a subscription row with status `active`, `past_due` or `canceled` whose
   period has not ended (a null period end is open-ended);
2. the same row for `GRACE_DAYS` after the period ended (not for `canceled`);
3. a running trial (`orgs.status = 'trial'` and `trial_ends_at` in the future),
   which gives `TRIAL_PLAN`;
4. `entitlement_overrides.plan`, until `expiresAt`;

and falls back to `free`. Per-feature and per-limit overrides are then applied
on top. A suspended org gets free.

`entitlement_overrides` is for the founding customers, goodwill extensions and
custom deals:

```json
{ "plan": "pro", "expiresAt": "2027-12-31T20:00:00Z", "note": "founding customer" }
{ "features": { "kds": true }, "limits": { "devicesPerLocation": 5 } }
```

## Who can write billing state

Only the system role. Migration 0014 revokes writes on `billing_subscriptions`
from `bite_app` and limits its `UPDATE` on `orgs` to `name`, `slug` and
`updated_at`. An owner's session cannot extend its own trial or grant itself a
plan, even with a bug in a route. Until there is an internal admin, set plans
with SQL as the owner or a `bite_system` login:

```sql
insert into billing_subscriptions (id, org_id, provider, plan, status, current_period_end)
values (gen_random_uuid(), '<org id>', 'manual', 'essentials', 'active', '2028-01-01T00:00:00Z');
```

## What is enforced today

| Limit or feature     | Where                                                            |
| -------------------- | ---------------------------------------------------------------- |
| `devicesPerLocation` | `POST /v1/admin/devices` (revoked devices do not count)          |
| `kds`                | `POST /v1/admin/devices` with `kind: "kds"`                      |
| `staff`              | `POST /v1/admin/staff`, `POST /v1/admin/staff/invite`            |
| `activePromotions`   | creating or re-activating a promotion                            |
| `reportHistoryDays`  | sales report, order list, orders CSV                             |
| `qr_ordering`        | guest order placement and `isAcceptingOrders` on the public menu |

A refused request is `402` with code `plan_limit` and `details` saying which
limit or feature, the current plan, and the cheapest plan that lifts it.

Not enforced yet, because the feature or the endpoint does not exist yet:
`locations` (there is no create-location route), `integrated_payments`,
`custom_branding`, `fawtara`, `full_reports` beyond the history window,
`multi_branch`, `tables`, `loyalty`, `audit_log`. Clients do not read
entitlements yet either; they arrive on `GET /v1/admin/me` and on every sync
pull, ready for upgrade prompts.

## Rules that do not bend

- Selling, taking cash, printing, closing a drawer, syncing and exporting data
  are never gated.
- Limits stop new things being added. They never delete or hide rows, so a
  downgrade leaves the data intact and an upgrade brings everything back.
- A tablet trusts its cached entitlements until `validUntil` (14 days), then
  falls back to free until it syncs.
