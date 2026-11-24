# Platform console (super admin)

Bite's own operators manage every business from `/platform` in the back
office app. It is not part of any org's back office.

## What it does

- Lists every business with status, plan, branch count, owner and usage
  (orders today, orders and sales over 30 days, last order, tablets), with
  search (name, handle, branch, owner email) and status/plan filters.
- One business: branches with their own usage, people, plan, billing rows and
  an activity log.
- Suspend and reactivate. Suspended orgs lose the back office, tablets and the
  guest menu (the existing lookups already exclude them).
- Set a plan (a `manual` row in `billing_subscriptions`, open-ended or until a
  date; "free" ends it) and set a trial. The console shows the plan each org
  would get with enforcement on, even while `PLAN_ENFORCEMENT` is off.
- Create a business: org, first branch, and an owner invite link. The owner
  signs up with that email and accepts it.
- Support view: "Open back office" shows that org's back office as an owner
  would see it, read-only. The API refuses anything but GET in support view,
  and every visit is logged.

Every platform action is written to that org's `audit_log` as `platform.*`,
with the operator's email.

## How it is wired

- API: `/v1/platform` (`apps/api/src/routes/platform.ts`). Cross-tenant reads
  go through a `bite_system` (BYPASSRLS) connection: `PLATFORM_DATABASE_URL`,
  or `WORKER_DATABASE_URL` when that is unset. Neither set = console off (404).
- Who is a platform admin: the `platform_admins` table (migration
  `*_platform_admins.sql`). Only the system role can read or write it, so no
  tenant session can promote itself. Not in the Drizzle schema on purpose.
- Anyone else, signed in or not, gets 404 from `/v1/platform`.
- Support view lives in `adminAuth` (`middleware/admin-auth.ts`): a login that
  isn't a member of the requested org but is a platform admin gets a
  synthetic owner context with `support: true`; `GET /v1/admin/me` returns
  `support: true` and the shell shows a banner.
- UI: `apps/admin/app/routes/platform*.tsx`, copy in `lib/platform-i18n.ts`,
  styles in `app/platform.css`. Needs the real API (`VITE_API_URL`).

## Making someone a platform admin

```sh
pnpm --filter @bite/api platform:seed someone@example.com   # existing login
```

`platform:seed` with no email (also run at the end of `demo:seed`) creates
`ops@bite.demo` / `bite-ops-2026` and three small sample businesses, and puts
Luban Café on Pro. Dev and demo only.
