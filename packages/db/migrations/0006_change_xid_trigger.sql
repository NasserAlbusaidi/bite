-- Keep orders.change_xid = the writing transaction's id on every update,
-- so sync pull never misses a change (see orders.ts). Payments and line
-- voids always update their order row in the same transaction, so they
-- move the order's change_xid too.
CREATE FUNCTION orders_touch_change_xid() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	NEW.change_xid := pg_current_xact_id();
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER orders_change_xid
	BEFORE UPDATE ON orders
	FOR EACH ROW EXECUTE FUNCTION orders_touch_change_xid();
--> statement-breakpoint
-- The idempotency ledger is append-only for the app, like audit_log.
REVOKE UPDATE, DELETE ON "sync_mutations" FROM bite_app;
