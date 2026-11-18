ALTER TABLE "orgs" ADD COLUMN "entitlement_overrides" jsonb;
--> statement-breakpoint
-- What an org has paid for must not be writable by the org's own session.
-- The app role keeps SELECT on both tables (it resolves entitlements from
-- them) but only the system role (worker, internal admin) writes billing
-- state. RLS alone would let an owner-scoped transaction update its own row.
REVOKE INSERT, UPDATE, DELETE ON "billing_subscriptions" FROM bite_app;
--> statement-breakpoint
-- On orgs the app may still rename the business; status, trial_ends_at and
-- entitlement_overrides are system-only. Column grants need the table-level
-- UPDATE gone first.
REVOKE UPDATE ON "orgs" FROM bite_app;
--> statement-breakpoint
GRANT UPDATE ("name", "slug", "updated_at") ON "orgs" TO bite_app;
